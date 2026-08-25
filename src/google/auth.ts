import { google } from "googleapis";
import { config } from "../config";

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function getOAuthClient() {
  const client = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  client.setCredentials({ refresh_token: config.google.refreshToken });
  return client;
}
