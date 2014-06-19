'use strict';

var imports = require('soop').imports();
var bitcore = require('bitcore');

var http;
if (process.version) {
  http = require('http');
};

function Insight(opts) {
  opts = opts || {};
  this.host = opts.host || 'localhost';
  this.port = opts.port || '3001';
  this.scheme = opts.scheme || 'http';
  this.retryDelay = opts.retryDelay || 5000;
}

function _asyncForEach(array, fn, callback) {
  array = array.slice(0);

  function processOne() {
    var item = array.pop();
    fn(item, function(result) {
      if (array.length > 0) {
        setTimeout(processOne, 0); // schedule immediately
      } else {
        callback(); // Done!
      }
    });
  }
  if (array.length > 0) {
    setTimeout(processOne, 0); // schedule immediately
  } else {
    callback(); // Done!
  }
};

function removeRepeatedElements(ar) {
  var ya = false,
    v = "",
    aux = [].concat(ar),
    r = Array();
  for (var i in aux) { // 
    v = aux[i];
    ya = false;
    for (var a in aux) {
      if (v == aux[a]) {
        if (ya == false) {
          ya = true;
        } else {
          aux[a] = "";
        }
      }
    }
  }
  for (var a in aux) {
    if (aux[a] != "") {
      r.push(aux[a]);
    }
  }
  return r;
}

Insight.prototype.getTransactions = function(addresses, cb) {
  var self = this;

  if (!addresses || !addresses.length) return cb([]);

  var txids = [];
  var txs = [];

  _asyncForEach(addresses, function(addr, callback) {
    var options = {
      host: self.host,
      port: self.port,
      scheme: self.scheme,
      method: 'GET',
      path: '/api/addr/' + addr,
      headers: {
        'Access-Control-Request-Headers': ''
      }
    };

    self._request(options, function(err, res) {
      var txids_tmp = res.transactions;
      for (var i = 0; i < txids_tmp.length; i++) {
        txids.push(txids_tmp[i]);
      }
      callback();
    });
  }, function() {
    var clean_txids = removeRepeatedElements(txids);
    _asyncForEach(clean_txids, function(txid, callback2) {
      var options = {
        host: self.host,
        port: self.port,
        scheme: self.scheme,
        method: 'GET',
        path: '/api/tx/' + txid,
        headers: {
          'Access-Control-Request-Headers': ''
        }
      };
      self._request(options, function(err, res) {
        txs.push(res);
        callback2();
      });
    }, function() {
      return cb(txs);
    });
  });
};

Insight.prototype.getUnspent = function(addresses, cb) {
  if (!addresses || !addresses.length) return cb(null, []);

  var all = [];

  var options = {
    host: this.host,
    port: this.port,
    scheme: this.scheme,
    method: 'POST',
    data: 'addrs=' + addresses.join(','),
    path: '/api/addrs/utxo',
    headers: {
      'Access-Control-Request-Headers': ''
    }
  };

  var self = this;
  this._request(options, function(err, res) {
    if (err) {
      return cb(err);
    }

    if (res && res.length > 0) {
      all = all.concat(res);
    }

    return cb(null, all);
  });
};

Insight.prototype.sendRawTransaction = function(rawtx, cb) {
  if (!rawtx) throw new Error('rawtx must be set');

  var options = {
    host: this.host,
    port: this.port,
    method: 'POST',
    path: '/api/tx/send',
    data: 'rawtx=' + rawtx,
    headers: {
      'Access-Control-Request-Headers': ''
    }
  };
  this._request(options, function(err, res) {
    if (err) return cb();

    return cb(res.txid);
  });
};

Insight.prototype._requestNode = function(options, callback) {
  if (options.method === 'POST') {
    options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': options.data.length,
    };
  }

  var req = http.request(options, function(response) {
    var ret, errTxt, e;
    if (response.statusCode == 200 || response.statusCode === 304) {
      response.on('data', function(chunk) {
        try {
          ret = JSON.parse(chunk);
        } catch (e2) {
          errTxt = 'CRITICAL:  Wrong response from insight' + e2;
        }
      });
    } else {
      errTxt = "INSIGHT ERROR:" + response.statusCode;
      console.log(errTxt);
      e = new Error(errTxt);
      return callback(e);
    }
    response.on('end', function() {
      if (errTxt) {
        console.log("INSIGHT ERROR:" + errTxt);
        e = new Error(errTxt);
      }
      return callback(e, ret);
    });
    response.on('error', function(e) {

      console.log('[Insight.js.201]'); //TODO
      return callback(e, ret);
    });
  });

  if (options.data) {
    req.write(options.data);
  }
  req.end();
};

Insight.prototype._requestBrowser = function(options, callback) {
  var request = new XMLHttpRequest();

  // TODO: Normalize URL
  var url = 'http://' + options.host;

  if (options.port !== 80) {
    url = url + ':' + options.port;
  }

  url = url + options.path;

  if (options.data && options.method === 'GET') {
    url = url + '?' + options.data;
  }

  request.open(options.method, url, true);
  request.timeout = 5000;
  request.ontimeout = function() {
    setTimeout(function() {
      return self._request(options, callback);
    }, self.retryDelay);
    return callback(new Error('Insight request timeout'));
  };

  request.onreadystatechange = function() {
    if (request.readyState !== 4) return;
    var ret, errTxt, e;

    if (request.status === 200 || request.status === 304) {
      try {
        ret = JSON.parse(request.responseText);
      } catch (e2) {
        errTxt = 'CRITICAL:  Wrong response from insight' + e2;
      }
    } else if (request.status >= 400 && request.status < 499) {
      errTxt = 'CRITICAL: Bad request to insight. Probably wrong transaction to broadcast?.';
    } else {
      errTxt = 'Error code: ' + request.status + ' - Status: ' + request.statusText + ' - Description: ' + request.responseText;
      setTimeout(function() {
        console.log('### Retrying Insight Request....');
        return self._request(options, callback);
      }, self.retryDelay);
    }
    if (errTxt) {
      console.log("INSIGHT ERROR:", e);
      e = new Error(errTxt);
    }
    return callback(e, ret);
  };

  if (options.method === 'POST') {
    request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  }

  request.send(options.data || null);
};

Insight.prototype._request = function(options, callback) {
  if (typeof process === 'undefined' || !process.version) {
    this._requestBrowser(options, callback);
  } else {
    this._requestNode(options, callback);
  }
};

module.exports = require('soop')(Insight);
