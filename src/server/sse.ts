

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express from "express"
import cors from "cors"
import crypto from "crypto"

import Logger from "../utils/logger.js"
import { startServer } from "./base.js"

const PORT = process.env.PORT || 10000

// Start the server in Streamable HTTP (Pure JSON + SSE) mode
export const startSSEServer = async () => {
  try {
    const app = express()
    app.use(cors())
    app.use(express.json())

    const server = startServer()
    
    // Enable enableJsonResponse to support Pure HTTP JSON-RPC requests (for ChatGPT / REST clients)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })

    await server.connect(transport)

    // Middleware to automatically inject required Accept headers for AI clients like ChatGPT
    app.use("/mcp", (req, res, next) => {
      if (req.headers['accept']) {
        if (!req.headers['accept'].includes('text/event-stream')) {
          req.headers['accept'] += ', text/event-stream';
        }
        if (!req.headers['accept'].includes('application/json')) {
          req.headers['accept'] += ', application/json';
        }
      } else {
        req.headers['accept'] = 'application/json, text/event-stream';
      }
      next();
    })

    // Handle both GET (SSE) and POST (Pure HTTP JSON-RPC / Messages) on /mcp
    app.get("/mcp", async (req, res) => {
      await transport.handleRequest(req, res)
    })

    app.post("/mcp", async (req, res) => {
      await transport.handleRequest(req, res, req.body)
    })

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", mode: "streamable-http", pureJson: true })
    })

    const httpServer = app.listen(PORT, () => {
      Logger.info(`Binance MCP Server running on HTTP/SSE mode at http://localhost:${PORT}`)
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
