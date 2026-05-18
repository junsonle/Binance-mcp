

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express from "express"
import cors from "cors"
import crypto from "crypto"

import Logger from "../utils/logger.js"
import { startServer } from "./base.js"

const PORT = process.env.PORT || 10000

// Start the server in SSE mode
export const startSSEServer = async () => {
  try {
    const app = express()
    app.use(cors())
    app.use(express.json())

    // Store active transports
    const transports: Map<string, SSEServerTransport> = new Map()

    // SSE endpoint - Client connects here first (MCP SSE probe hits this)
    app.get("/mcp", async (req, res) => {
      const sessionId = req.query.sessionId as string || crypto.randomUUID()
      
      Logger.info(`New SSE connection: ${sessionId}`)
      
      // SSEServerTransport automatically responds with 200 OK, text/event-stream,
      // and sends 'event: endpoint' with data: '/message?sessionId=...'
      const transport = new SSEServerTransport("/message", res)
      transports.set(sessionId, transport)
      
      res.on("close", () => {
        Logger.info(`SSE connection closed: ${sessionId}`)
        transports.delete(sessionId)
      })

      // Create a fresh McpServer instance per connection to prevent "Already connected" errors
      const server = startServer()
      await server.connect(transport)
    })

    // Message endpoint - Client POSTs JSON-RPC messages here
    app.post("/message", async (req, res) => {
      const sessionId = req.query.sessionId as string
      const transport = transports.get(sessionId)
      
      if (!transport) {
        res.status(404).json({ error: "Session not found" })
        return
      }

      await transport.handlePostMessage(req, res)
    })

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", mode: "sse" })
    })

    const httpServer = app.listen(PORT, () => {
      Logger.info(`Binance MCP Server running on SSE mode at http://localhost:${PORT}`)
      Logger.info(`SSE endpoint: http://localhost:${PORT}/mcp`)
    })

    return {
      close: async () => {
        httpServer.close()
      }
    } as any
  } catch (error) {
    Logger.error("Error starting Binance MCP SSE server:", error)
  }
}
