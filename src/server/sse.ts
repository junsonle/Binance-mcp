import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express from "express"
import cors from "cors"
import path from "path"

import Logger from "../utils/logger.js"
import { startServer } from "./base.js"

const PORT = parseInt(process.env.PORT || "10000", 10)

// Start the server in SSE mode
export const startSSEServer = async () => {
  try {
    const app = express()

    // CORS - allow all origins for MCP client compatibility (ChatGPT, Claude, etc.)
    app.use(cors({
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    }))
    app.use(express.json())

    // Store active transports keyed by transport's internal sessionId
    const transports: Map<string, SSEServerTransport> = new Map()

    // Serve .well-known for MCP discovery
    const projectRoot = process.cwd()
    app.use("/.well-known", express.static(path.join(projectRoot, ".well-known")))

    // Root info endpoint
    app.get("/", (_req, res) => {
      res.json({
        name: "binance-mcp",
        version: "1.0.0",
        description: "MCP server for Binance exchange - spot trading, staking, wallet, NFT, pay, mining, and more",
        transport: "sse",
        endpoints: {
          sse: "/sse",
          message: "/message",
          health: "/health",
        }
      })
    })

    // SSE connection handler (shared between /sse and /mcp)
    const handleSSEConnection = async (req: express.Request, res: express.Response) => {
      Logger.info(`New SSE connection request from ${req.ip}`)

      // Create transport - it generates its own sessionId internally
      // and sends "event: endpoint" with data: /message?sessionId=<id> to the client
      const transport = new SSEServerTransport("/message", res)

      // IMPORTANT: Use transport.sessionId as map key so POST /message lookup works
      // The client will POST to /message?sessionId=<transport.sessionId>
      transports.set(transport.sessionId, transport)
      Logger.info(`SSE session established: ${transport.sessionId}`)

      res.on("close", () => {
        Logger.info(`SSE connection closed: ${transport.sessionId}`)
        transports.delete(transport.sessionId)
      })

      // Create a fresh McpServer instance per connection to prevent "Already connected" errors
      const server = startServer()
      await server.connect(transport)
    }

    // Support both /sse (standard MCP convention) and /mcp (legacy)
    app.get("/sse", handleSSEConnection)
    app.get("/mcp", handleSSEConnection)

    // Message endpoint - Client POSTs JSON-RPC messages here
    app.post("/message", async (req, res) => {
      const sessionId = req.query.sessionId as string

      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId query parameter" })
        return
      }

      const transport = transports.get(sessionId)

      if (!transport) {
        Logger.warn(`Session not found: ${sessionId}`)
        res.status(404).json({ error: "Session not found. The SSE connection may have been closed." })
        return
      }

      try {
        await transport.handlePostMessage(req, res)
      } catch (error) {
        Logger.error(`Error handling message for session ${sessionId}:`, error)
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" })
        }
      }
    })

    // Health check
    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        mode: "sse",
        activeSessions: transports.size,
        uptime: process.uptime()
      })
    })

    const httpServer = app.listen(PORT, "0.0.0.0", () => {
      Logger.info(`Binance MCP Server running on SSE mode at http://0.0.0.0:${PORT}`)
      Logger.info(`SSE endpoint: /sse`)
      Logger.info(`Message endpoint: /message`)
      Logger.info(`Health check: /health`)
    })

    // Increase timeouts for long-lived SSE connections
    httpServer.keepAliveTimeout = 120000
    httpServer.headersTimeout = 125000

    return {
      close: async () => {
        httpServer.close()
      }
    } as any
  } catch (error) {
    Logger.error("Error starting Binance MCP SSE server:", error)
  }
}
