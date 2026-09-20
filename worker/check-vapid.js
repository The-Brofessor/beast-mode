/* Checks that what you copied is a valid VAPID private key, without printing
   it and without putting it in your shell history.

     node worker/check-vapid.js

   Paste the private JSON at the prompt, press Enter, then Ctrl+Z and Enter on
   Windows (Ctrl+D on Mac and Linux).

   It reports valid or not, and prints the PUBLIC key derived from it so you
   can confirm it matches the one already in wrangler.toml. It never prints
   the private value. */

const { webcrypto } = require('node:crypto');

const EXPECTED_PUBLIC =
  'BDpOB42o2rDOh6fd0DrTSWRm7rj6LUu3IKcX51r9yA1JOGJEefM1d3PjWek2o3ju9xk7Vyt2vUuzocjqwxFPusE';

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

process.stdout.write('Paste the private key JSON, then Enter, then Ctrl+Z and Enter:\n\n');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  const text = input.trim();

  if (!text) { console.log('\nNothing pasted.'); process.exit(1); }
  if (text[0] !== '{' || text[text.length - 1] !== '}') {
    console.log('\nThat does not start with { and end with }.');
    console.log('Copy the whole JSON object, braces included.');
    console.log('You pasted ' + text.length + ' characters starting with: ' + text.slice(0, 12) + '...');
    process.exit(1);
  }

  let jwk;
  try { jwk = JSON.parse(text); }
  catch (e) { console.log('\nNot valid JSON: ' + e.message); process.exit(1); }

  const missing = ['kty', 'crv', 'x', 'y', 'd'].filter(k => !jwk[k]);
  if (missing.length) {
    console.log('\nMissing field(s): ' + missing.join(', '));
    if (missing.includes('d')) console.log('No "d" means this is the PUBLIC key, not the private one.');
    process.exit(1);
  }

  try {
    const priv = await webcrypto.subtle.importKey(
      'jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);

    // Prove it can actually sign, which is the whole job.
    await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new Uint8Array([1]));

    const pub = await webcrypto.subtle.importKey(
      'jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const derived = b64url(await webcrypto.subtle.exportKey('raw', pub));

    console.log('\n  Valid private key. ' + text.length + ' characters, d is ' + jwk.d.length + ' characters.');
    console.log('  It signs correctly.');
    console.log('\n  Public key derived from it:');
    console.log('    ' + derived);
    console.log('\n  ' + (derived === EXPECTED_PUBLIC
      ? 'Matches the public key already in wrangler.toml. This is the right pair.'
      : 'DOES NOT match the public key in wrangler.toml.\n  You may have generated a second pair. Use the one that matches, or\n  update wrangler.toml and index.html with the public key printed above.'));
    console.log('\n  Now paste the same JSON into: npx wrangler secret put VAPID_PRIVATE_JWK\n');
  } catch (e) {
    console.log('\nThose fields do not form a usable key: ' + e.message);
    process.exit(1);
  }
});
