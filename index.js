var pkg = require('./package.json')
var packets = require('./packets')
var dgram = require('dgram')
var thunky = require('thunky')
var events = require('events')
var debug = require('debug')(pkg.name)

var noop = function () {}

module.exports = function (opts) {
  if (!opts) opts = {}

  var that = new events.EventEmitter()
  var port = opts.port || 5353
  var type = opts.type || 'udp4'
  var ip = opts.ip || opts.host || (type === 'udp4' ? '224.0.0.251' : null)

  debug('opts %j', opts)

  if (type === 'udp6' && (!ip || !opts.interface)) {
    throw new Error('For IPv6 multicast you must specify `ip` and `interface`')
  }

  var createSocket = function () {
    var socket = dgram.createSocket({
      type: type,
      reuseAddr: opts.reuseAddr !== false,
      toString: function () {
        return type
      }
    })

    socket.on('error', function (err) {
      that.emit('warning', err)
    })

    socket.on('message', function (message, rinfo) {
      try {
        message = packets.decode(message)
      } catch (err) {
        that.emit('warning', err)
        return
      }

      that.emit('packet', message, rinfo)

      if (message.type === 'query') that.emit('query', message, rinfo)
      if (message.type === 'response') that.emit('response', message, rinfo)
    })

    socket.on('listening', function () {
      if (opts.multicast !== false) {
        socket.addMembership(ip, opts.interface)
        socket.setMulticastTTL(opts.ttl || 255)
        socket.setMulticastLoopback(opts.loopback !== false)
      }
    })

    return socket
  }

  var receiveSocket = createSocket()
  var sendSocket = createSocket()

  var sendBind = thunky(function (cb) {
    sendSocket.on('error', cb)
    sendSocket.bind(0, function () {
      debug('sendSocket bound to %j', sendSocket.address())
      sendSocket.removeListener('error', cb)
      cb(null, sendSocket)
    })
  })

  debug('receiveSocket bind %s', port)
  receiveSocket.bind(port, function () {
    that.emit('ready')
  })

  that.send = function (packet, cb) {
    if (!cb) cb = noop
    sendBind(function (err, socket) {
      if (err) return cb(err)
      var message = packets.encode(packet)
      debug('emit message to %s:%s', ip, port)
      debug('%j', packet)
      sendSocket.send(message, 0, message.length, port, ip, cb)
    })
  }

  that.response =
  that.respond = function (res, cb) {
    if (!cb) cb = noop
    if (Array.isArray(res)) res = {answers: res}
    res.type = 'response'
    debug('send response')
    that.send(res, cb)
  }

  that.query = function (q, type, cb) {

    debug('send query')

    if (typeof type === 'function') return that.query(q, null, type)
    if (!cb) cb = noop

    if (typeof q === 'string') q = [{name: q, type: type || 'ANY'}]
    if (Array.isArray(q)) q = {type: 'query', questions: q}

    q.type = 'query'

    that.send(q, cb)
  }

  that.destroy = function (cb) {
    if (!cb) cb = noop
    debug('destroy sendSocket')
    sendSocket.once('close', function () {
      debug('destroy receiveSocket')
      receiveSocket.once('close', cb)
      receiveSocket.close()
    })
    sendSocket.close()
  }

  that.on('response', function (response) {
    debug('grabbed a response')
    debug('%j', response)
  })
  that.on('query', function (query) {
    debug('grabbed a query')
    debug('%j', query)
  })

  return that
}
