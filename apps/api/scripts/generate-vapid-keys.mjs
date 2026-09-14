#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for Web Push (docs/decisions/0005-push-notifications.md).
 *
 * It prints to stdout and writes nothing: the private key belongs in `.env`, which is
 * never committed, and a script that edited files for you would make it far too easy
 * to rotate a production key by accident.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('Copie para o seu .env (nunca versione a chave privada):\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:voce@suaagencia.com.br');
