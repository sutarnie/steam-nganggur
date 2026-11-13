declare module 'steam-totp' {
  export function getAuthCode(sharedSecret: string): string;
  export function getConfirmationKey(identitySecret: string, time: number, tag: string): string;
  export function getDeviceID(steamID: string): string;
}
