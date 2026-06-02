import { registerGmailPrimitives } from "./registry";

export function createGmailModule() {
  return {
    registerCapabilities: registerGmailPrimitives,
  };
}
