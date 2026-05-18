import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import express from "express"
import cors from "cors"
import crypto from "crypto"
import path from "path"

import Logger from "../utils/logger.js"
import { startServer } from "./base.js"

const PORT = parseInt(process.env.PORT || "10000", 10)

// Start the server in Streamable HTTP mode
export const startHTTPServer = async () => {
  try {
    const app = express()

    // CORS - allow all origins for MCP client compatibility (ChatGPT, Claude, etc.)
    app.use(cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "Last-Event-ID", "Mcp-Protocol-Version"],
      exposedHeaders: ["Mcp-Session-Id"],
    }))
    app.use(express.json())

    // Store active sessions: sessionId -> { transport, server }
    const sessions = new Map<string, {
      transport: StreamableHTTPServerTransport
    }>()

    // Serve .well-known for MCP discovery
    const projectRoot = process.cwd()
    app.use("/.well-known", express.static(path.join(projectRoot, ".well-known")))

    // Root info endpoint
    app.get("/", (_req, res) => {
      res.json({
        name: "binance-mcp",
        version: "1.0.0",
        description: "MCP server for Binance exchange - spot trading, staking, wallet, NFT, pay, mining, and more",
        transport: "streamable-http",
        endpoints: {
          mcp: "/mcp",
          health: "/health",
        }
      })
    })

    // ============================================================
    // MCP Streamable HTTP endpoint at /mcp
    // Handles POST (messages), GET (SSE stream), DELETE (close session)
    // ============================================================

    // POST /mcp — JSON-RPC messages (initialize + subsequent)
    app.post("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined
      const body = req.body

      // Case 1: Existing session — route message to its transport
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        try {
          await session.transport.handleRequest(req, res, body)
        } catch (error) {
          Logger.error(`Error handling message for session ${sessionId}:`, error)
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null
            })
          }
        }
        return
      }

      // Case 2: No session yet — must be an initialize request
      const message = Array.isArray(body) ? body[0] : body
      if (isInitializeRequest(message)) {
        Logger.info("New MCP session initializing...")

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id: string) => {
            Logger.info(`MCP session created: ${id}`)
            sessions.set(id, { transport })
          },
        })

        transport.onclose = () => {
          const id = transport.sessionId
          if (id) {
            Logger.info(`MCP session closed: ${id}`)
            sessions.delete(id)
          }
        }

        transport.onerror = (error) => {
          Logger.error("Transport error:", error)
        }

        // Create a fresh McpServer instance per session
        const mcpServer = startServer()
        await mcpServer.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      }

      // Case 3: Invalid — no session and not an initialize request
      if (sessionId) {
        // Session ID provided but not found (expired or invalid)
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found. It may have expired." },
          id: null
        })
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Bad Request: Missing session ID. Send an initialize request first." },
          id: null
        })
      }
    })

    // GET /mcp — SSE stream for server-initiated messages
    app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string

      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing Mcp-Session-Id header" })
        return
      }

      const session = sessions.get(sessionId)!
      try {
        await session.transport.handleRequest(req, res)
      } catch (error) {
        Logger.error(`Error handling GET for session ${sessionId}:`, error)
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" })
        }
      }
    })

    // DELETE /mcp — Close session
    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string

      if (!sessionId || !sessions.has(sessionId)) {
        res.status(404).json({ error: "Session not found" })
        return
      }

      const session = sessions.get(sessionId)!
      try {
        await session.transport.handleRequest(req, res)
      } catch (error) {
        Logger.error(`Error handling DELETE for session ${sessionId}:`, error)
        sessions.delete(sessionId)
        if (!res.headersSent) {
          res.status(500).json({ error: "Error closing session" })
        }
      }
    })

    // Health check
    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        mode: "streamable-http",
        activeSessions: sessions.size,
        uptime: process.uptime()
      })
    })

    const httpServer = app.listen(PORT, "0.0.0.0", () => {
      Logger.info(`Binance MCP Server running on Streamable HTTP mode at http://0.0.0.0:${PORT}`)
      Logger.info(`MCP endpoint: /mcp`)
      Logger.info(`Health check: /health`)
    })

    // Increase timeouts for long-lived connections
    httpServer.keepAliveTimeout = 120000
    httpServer.headersTimeout = 125000

    return {
      close: async () => {
        httpServer.close()
      }
    } as any
  } catch (error) {
    Logger.error("Error starting Binance MCP HTTP server:", error)
  }
}
