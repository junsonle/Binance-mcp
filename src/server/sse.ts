

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express from "express"
import cors from "cors"
import crypto from "crypto"

import Logger from "../utils/logger.js"
import { startServer } from "./base.js"

const PORT = process.env.PORT || 10000

// Start the server in Streamable HTTP mode
export const startSSEServer = async () => {
  try {
    const app = express()
    app.use(cors())
    app.use(express.json())

    const server = startServer()
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })

    await server.connect(transport)

    // Handle both GET (SSE) and POST (Messages) on /mcp
    app.get("/mcp", async (req, res) => {
      await transport.handleRequest(req, res)
    })

    app.post("/mcp", async (req, res) => {
      await transport.handleRequest(req, res, req.body)
    })

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", mode: "streamable-http" })
    })

    const httpServer = app.listen(PORT, () => {
      Logger.info(`Binance MCP Server running on streamable-http mode at http://localhost:${PORT}`)
      Logger.info(`MCP endpoint: http://localhost:${PORT}/mcp`)
    })

    return {
      close: async () => {
        await transport.close()
        httpServer.close()
      }
    } as any
  } catch (error) {
    Logger.error("Error starting Binance MCP HTTP server:", error)
  }
}
