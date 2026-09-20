/* Generates the VAPID key pair for push. Run once, ever:

     node worker/generate-vapid.js

   It prints two things. The public key goes into index.html as a constant and
   is safe to publish. The private key is a secret: paste it into

     npx wrangler secret put VAPID_PRIVATE_JWK

   and do not commit it, paste it into chat, or put it in the repo.

   No dependencies: Node's WebCrypto, same rule as the rest of the project. */

const { webcrypto } = require('node:crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

(async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );

  const rawPublic = await webcrypto.subtle.exportKey('raw', pair.publicKey);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);

  console.log('\nPUBLIC KEY  (paste into index.html as VAPID_PUBLIC_KEY, safe to publish)\n');
  console.log('  ' + b64url(rawPublic));
  console.log('\nPRIVATE KEY (wrangler secret put VAPID_PRIVATE_JWK, never commit this)\n');
  console.log('  ' + JSON.stringify(privateJwk));
  console.log('\nKeep the private key somewhere safe. Losing it means every client');
  console.log('has to re-subscribe.\n');
})();
