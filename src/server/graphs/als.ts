// LangGraph needs a real AsyncLocalStorage for interrupt() and config propagation.
// Workers provide one through nodejs_compat; register it once per isolate.
import { AsyncLocalStorage } from "node:async_hooks";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";

AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
