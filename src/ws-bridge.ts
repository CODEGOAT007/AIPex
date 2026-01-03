/**
 * WebSocket Bridge for MCP Server Communication
 *
 * Connects to the AIPex MCP Bridge server and handles tool calls from Claude Code CLI.
 * The bridge provides browser control capabilities to external AI tools.
 *
 * This bridge dynamically forwards ALL tool calls to callMcpTool - no hardcoded tool list.
 */

import { callMcpTool, McpRequest } from './mcp/index'

const WS_SERVER_URL = 'ws://localhost:9876'
const RECONNECT_DELAY = 5000

let ws: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let isConnecting = false

function connect() {
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) {
    return
  }

  isConnecting = true
  console.log('[WS Bridge] Connecting to MCP server...')

  try {
    ws = new WebSocket(WS_SERVER_URL)

    ws.onopen = () => {
      isConnecting = false
      console.log('[WS Bridge] Connected to MCP server')

      // Clear any pending reconnect
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
    }

    ws.onclose = () => {
      isConnecting = false
      console.log('[WS Bridge] Disconnected from MCP server')
      ws = null
      scheduleReconnect()
    }

    ws.onerror = (error) => {
      isConnecting = false
      console.error('[WS Bridge] WebSocket error:', error)
    }

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'tool_call') {
          const { id, tool, args = {} } = message
          console.log('[WS Bridge] Received tool call:', tool, args)

          try {
            // Build McpRequest dynamically - just pass tool name and args through
            // callMcpTool will handle validation and execution
            const request = { tool, args } as McpRequest

            // Execute the tool
            const result = await callMcpTool(request)

            // Send the response back
            if (result.success) {
              sendResponse(id, result.data)
            } else {
              sendResponse(id, null, result.error || 'Tool execution failed')
            }
          } catch (toolError: any) {
            console.error('[WS Bridge] Tool execution error:', toolError)
            sendResponse(id, null, JSON.stringify({
              error: toolError?.message || String(toolError),
              context: {
                tool,
                args,
                stack: toolError?.stack?.split('\n').slice(0, 5).join('\n'),
                timestamp: new Date().toISOString()
              }
            }))
          }
        }
      } catch (parseError) {
        console.error('[WS Bridge] Failed to parse message:', parseError)
      }
    }
  } catch (error) {
    isConnecting = false
    console.error('[WS Bridge] Failed to create WebSocket:', error)
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) {
    return // Already scheduled
  }

  console.log(`[WS Bridge] Reconnecting in ${RECONNECT_DELAY / 1000}s...`)
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    connect()
  }, RECONNECT_DELAY)
}

function sendResponse(id: number, result: any, error?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[WS Bridge] Cannot send response - not connected')
    return
  }

  const response = {
    id,
    type: 'tool_response',
    result,
    error
  }

  ws.send(JSON.stringify(response))
}

// Initialize the WebSocket bridge
export function initWsBridge() {
  console.log('[WS Bridge] Initializing WebSocket bridge...')
  connect()
}

// Cleanup function
export function closeWsBridge() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  if (ws) {
    ws.close()
    ws = null
  }
}
