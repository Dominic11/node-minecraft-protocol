'use strict'

const crypto = require('crypto')
const debug = require('debug')('minecraft-protocol')
const yggdrasil = require('yggdrasil')
const mcleaks = require('node-mcleaks')

module.exports = function (client, options) {
  const yggdrasilServer = yggdrasil.server({ agent: options.agent })
  client.once('encryption_begin', onEncryptionKeyRequest)

  function onEncryptionKeyRequest (packet) {
    crypto.randomBytes(16, gotSharedSecret)

    function gotSharedSecret (err, sharedSecret) {
      if (err) {
        debug(err)
        client.emit('error', err)
        client.end()
        return
      }
      if (options.haveCredentials) {
        joinServerRequest(onJoinServerResponse)
      } else {
        if (packet.serverId !== '-') {
          debug('This server appears to be an online server and you are providing no password, the authentication will probably fail')
        }
        sendEncryptionKeyResponse()
      }

      function onJoinServerResponse (err) {
        if (err) {
          client.emit('error', err)
          client.end()
        } else {
          sendEncryptionKeyResponse()
        }
      }

      function joinServerRequest(cb) {
        if (options.mcLeaksToken) {
          // Join server with MCLeaks
          mcleaks.join({
            session: options.accessToken,
            mcname: client.username,
            server: (options.host || 'localhost')+":"+options.port||'25565',
            serverid: packet.serverId,
            sharedsecret: sharedSecret,
            serverkey: packet.publicKey
          }, cb);
        } else {
          // Join server with Mojang account
          yggdrasilServer.join(options.accessToken, client.session.selectedProfile.id,
              packet.serverId, sharedSecret, packet.publicKey, cb);
        }
      }

      function sendEncryptionKeyResponse () {
        const pubKey = mcPubKeyToPem(packet.publicKey)
        const encryptedSharedSecretBuffer = crypto.publicEncrypt({ key: pubKey, padding: crypto.constants.RSA_PKCS1_PADDING }, sharedSecret)
        const encryptedVerifyTokenBuffer = crypto.publicEncrypt({ key: pubKey, padding: crypto.constants.RSA_PKCS1_PADDING }, packet.verifyToken)
        client.write('encryption_begin', {
          sharedSecret: encryptedSharedSecretBuffer,
          verifyToken: encryptedVerifyTokenBuffer
        })
        client.setEncryption(sharedSecret)
      }
    }
  }
}

function mcPubKeyToPem (mcPubKeyBuffer) {
  let pem = '-----BEGIN PUBLIC KEY-----\n'
  let base64PubKey = mcPubKeyBuffer.toString('base64')
  const maxLineLength = 65
  while (base64PubKey.length > 0) {
    pem += base64PubKey.substring(0, maxLineLength) + '\n'
    base64PubKey = base64PubKey.substring(maxLineLength)
  }
  pem += '-----END PUBLIC KEY-----\n'
  return pem
}
