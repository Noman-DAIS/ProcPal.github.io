// agents.js 

// imports
import { MAIN_CHAT_PROMPT, DECISION_AGENT_PROMPT } from "./prompts.js";
import { functionDefinitions, functionImplementations, executeFunction } from "./functions.js";


// Helper function to get agent configuration
export const getAgentConfig = (agentName) => AGENT_CONFIG[agentName];

// Helper function to get all agent names
export const getAgentNames = () => Object.keys(AGENT_CONFIG);

// Agent Configuration
export const AGENT_CONFIG = {
  mainChat: {
    name: "Main Chat Agent",
    systemPrompt: MAIN_CHAT_PROMPT,
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 1000
  },
  decisionAgent: {
    name: "Function Decision Agent",
    systemPrompt: DECISION_AGENT_PROMPT,
    model: "gpt-4o-mini",
    temperature: 0.1,
    maxTokens: 50
  }
};


/**
 * Base API communication class
 */
class APIClient {
  constructor() {
    this.apiKey = localStorage.getItem("OPENAI_API_KEY");
    if (!this.apiKey) {
      throw new Error("API key not found. Set it with: localStorage.setItem('OPENAI_API_KEY','sk-...')");
    }
  }

  async makeRequest(requestBody) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${this.apiKey}` 
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }
}


/**
 * Main Chat Agent - Handles primary conversation
 */
export class MainChatAgent extends APIClient {
  constructor() {
    super();
    this.config = getAgentConfig('mainChat');
  }

  async sendMessage(messages, functionCall = null) {
    const requestBody = {
      model: this.config.model,
      stream: true,
      messages: messages,
      functions: Object.values(functionDefinitions),
      function_call: "auto"
    };

    // If this is a function call response, add it to the messages
    if (functionCall) {
      requestBody.messages.push(functionCall);
    }

    return await this.makeRequest(requestBody);
  }
}

/**
 * Decision Agent - Determines if more function calls are needed
 */
export class DecisionAgent extends APIClient {
  constructor() {
    super();
    this.config = getAgentConfig('decisionAgent');
  }

  async shouldContinue(conversationContext, functionResults) {
    const contextMessage = `Conversation Context: ${conversationContext}\n\nFunction Results: ${functionResults}\n\nShould we call more functions?`;
    
    const requestBody = {
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: contextMessage }
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature
    };

    const response = await this.makeRequest(requestBody);
    const data = await response.json();
    const decision = data.choices?.[0]?.message?.content?.trim();
    
    return decision === "MORE_FUNCTIONS_NEEDED";
  }
}

/**
 * Function Executor - Handles function execution
 */
export class FunctionExecutor {
  constructor() {
    this.functions = functionImplementations;
  }

  async executeFunctionCall(functionCall) {
    try {
      const { name, arguments: argsString } = functionCall;
      const args = JSON.parse(argsString);
      
      const result = await executeFunction(name, args);
      
      return {
        role: "function",
        name: name,
        content: result
      };
    } catch (error) {
      console.error("Function execution error:", error);
      
      return {
        role: "function",
        name: functionCall.name,
        content: `Error: ${error.message}`
      };
    }
  }

  getAvailableFunctions() {
    return Object.keys(this.functions);
  }
}

/**
 * Multi-Agent Coordinator - Orchestrates all agents
 */
export class MultiAgentCoordinator {
  constructor() {
    this.mainChatAgent = new MainChatAgent();
    this.decisionAgent = new DecisionAgent();
    this.functionExecutor = new FunctionExecutor();
    this.maxIterations = 10; // Increased from 5 to 10
  }

  async processUserMessage(userText, history, addMessageCallback, messageElement = null) {
    try {
      // Add user message to history
      history.push({ role: "user", content: userText });
      
      // Send to main chat agent
      const response = await this.mainChatAgent.sendMessage(history);
      const { reply, functionCall } = await this.processStreamResponse(response, addMessageCallback, messageElement);
      
      // Add assistant reply to history
      history.push({ role: "assistant", content: reply });
      
      // Handle function calls with decision agent loop
      let currentFunctionCall = functionCall;
      let iteration = 0;
      let allFunctionResults = [];
      
      while (currentFunctionCall && iteration < this.maxIterations) {
        iteration++;
        
        // Execute the function call
        const functionResult = await this.functionExecutor.executeFunctionCall(currentFunctionCall);
        allFunctionResults.push(functionResult);
        
        // Show function call in UI
        addMessageCallback("assistant", `Calling function: ${currentFunctionCall.name}(${JSON.stringify(JSON.parse(currentFunctionCall.arguments))})`, "alert-info");
        
        // Show function result in UI
        addMessageCallback("assistant", `Function result: ${functionResult.content}`, "alert-success");
        
        // Add function result to history
        history.push(functionResult);
        
        // Send function result back to main chat agent
        const followUpResponse = await this.mainChatAgent.sendMessage(history, {
          role: "assistant",
          content: null,
          function_call: currentFunctionCall
        });
        
        // Process the follow-up response
        const { reply: followUpReply, functionCall: nextFunctionCall } = await this.processStreamResponse(followUpResponse, addMessageCallback);
        
        // Add follow-up reply to history
        history.push({ role: "assistant", content: followUpReply });
        
        // Ask decision agent if we need more function calls
        const conversationContext = `User asked: "${userText}"\nAssistant replied: "${followUpReply}"`;
        const functionResultsSummary = allFunctionResults.map(fr => `${fr.name}: ${fr.content}`).join('\n');
        
        const shouldContinue = await this.decisionAgent.shouldContinue(conversationContext, functionResultsSummary);
        
        // Show decision agent's decision in UI
        const decisionText = shouldContinue ? "MORE_FUNCTIONS_NEEDED" : "COMPLETE";
        addMessageCallback("assistant", `${this.decisionAgent.config.name}: ${decisionText}`, "alert-warning");
        
        if (!shouldContinue) {
          // Decision agent says we're complete
          addMessageCallback("assistant", "Decision Agent: Task completed successfully!", "alert-success");
          break;
        }
        
        // Check if there's another function call
        currentFunctionCall = nextFunctionCall;
      }
      
      if (iteration >= this.maxIterations && currentFunctionCall) {
        addMessageCallback("assistant", "Maximum function call iterations reached. Stopping to prevent infinite loop.", "alert-warning");
      }
      
    } catch (error) {
      console.error("Multi-agent processing error:", error);
      addMessageCallback("assistant", `Error: ${error.message}`, "alert-danger");
    }
  }

  async processStreamResponse(response, addMessageCallback, messageElement = null) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let functionCall = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        
        for (const part of parts) {
          if (!part.startsWith("data:")) continue;
          
          const data = part.slice(5).trim();
          if (data === "[DONE]") break;
          
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            
            // Handle content delta
            const delta = choice?.delta?.content || "";
            if (delta) {
              reply += delta;
              // Update UI if message element is provided
              if (messageElement) {
                messageElement.textContent += delta;
              }
            }
            
            // Handle function call
            const functionCallDelta = choice?.delta?.function_call;
            if (functionCallDelta) {
              if (!functionCall) {
                functionCall = {
                  name: functionCallDelta.name || "",
                  arguments: functionCallDelta.arguments || ""
                };
              } else {
                if (functionCallDelta.name) {
                  functionCall.name += functionCallDelta.name;
                }
                if (functionCallDelta.arguments) {
                  functionCall.arguments += functionCallDelta.arguments;
                }
              }
            }
          } catch (parseError) {
            // Skip malformed JSON chunks
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    return { reply, functionCall };
  }
}


