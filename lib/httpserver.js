var log = require('ringo/logging').getLogger(module.id);
var {XmlConfiguration} = org.eclipse.jetty.xml;
var {Server, HttpConfiguration, HttpConnectionFactory,
        ServerConnector, SslConnectionFactory,
        SecureRequestCustomizer} = org.eclipse.jetty.server;
var {HandlerCollection, ContextHandlerCollection} = org.eclipse.jetty.server.handler;
var {HTTP_1_1} = org.eclipse.jetty.http.HttpVersion;
var {HashSessionIdManager} = org.eclipse.jetty.server.session;
var {SslContextFactory} = org.eclipse.jetty.util.ssl;

var objects = require("ringo/utils/objects");
var ApplicationContext = require("./context/application");
var StaticContext = require("./context/static");
var WebSocketContext = require("./context/websocket");

var fs = require("fs");

var HttpServer = module.exports = function HttpServer(options) {
    if (!(this instanceof HttpServer)) {
        return new HttpServer(options);
    }

    var jetty = new Server();

    var xmlConfig = null;

    Object.defineProperties(this, {
        "jetty": {
            "value": jetty,
            "enumerable": true
        },
        "xmlConfig": {
            "get": function() {
                return xmlConfig;
            },
            "set": function(config) {
                if (!(config instanceof XmlConfiguration)) {
                    throw new Error("Invalid jetty xml configuration");
                }
                xmlConfig = config;
                xmlConfig.configure(jetty);
            },
            "enumerable": true
        },
        "contexts": {
            "value": {},
            "enumerable": true
        }
    });

    if (typeof(options) === "string") {
        // path to jetty xml configuration
        this.configure(options);
    } else if (typeof(options) === "object" && options.constructor === Object) {
        jetty.setStopAtShutdown(options.stopAtShutdown !== false);
        jetty.setStopTimeout(options.stopTimeout || 1000);
        jetty.setDumpAfterStart(options.dumpBeforeStart === true);
        jetty.setDumpBeforeStop(options.dumpBeforeStop === true);
    }
    return this;
};

HttpServer.prototype.toString = function() {
    return "[HttpServer]";
};

HttpServer.prototype.configure = function(xmlPath) {
    var xmlResource = getResource(xmlPath);
    if (!xmlResource.exists()) {
        throw Error('Jetty XML configuration "' + xmlResource + '" not found');
    }
    return this.xmlConfig = new XmlConfiguration(xmlResource.inputStream);
};

HttpServer.prototype.createHttpConfig = function(options) {
    options = objects.merge(options || {}, {
        "requestHeaderSize": 8129,
        "outputBufferSize": 32768,
        "responseHeaderSize": 8129,
        "secureScheme": "https"
    });
    var httpConfig = new HttpConfiguration();
    httpConfig.setRequestHeaderSize(options.requestHeaderSize);
    httpConfig.setOutputBufferSize(options.outputBufferSize);
    httpConfig.setResponseHeaderSize(options.responseHeaderSize);
    httpConfig.setSecureScheme(options.secureScheme);
    httpConfig.setSendServerVersion(options.sendServerVersion === true);
    httpConfig.setSendDateHeader(options.sendDateHeader !== false);
    return httpConfig;
};

HttpServer.prototype.createConnector = function(connectionFactory, options) {
    var connector = new ServerConnector(this.jetty, options.acceptors || -1,
            options.selectors || -1, connectionFactory);
    connector.setHost(options.host);
    connector.setPort(options.port);
    connector.setIdleTimeout(options.idleTimeout || 30000);
    connector.setSoLingerTime(options.soLingerTime || -1);
    connector.setAcceptorPriorityDelta(options.acceptorPriorityDelta || 0);
    connector.setSelectorPriorityDelta(options.selectorPriorityDelta || 0);
    connector.setAcceptQueueSize(options.acceptQueueSize || 0);
    if (typeof(options.name) === "string") {
        connector.setName(options.name);
    }
    return connector;
};

HttpServer.prototype.createHttpConnector = function(options) {
    options = objects.merge(options || {}, {
        "host": "0.0.0.0",
        "port": 8080
    });
    var httpConfig = this.createHttpConfig(options);
    var connectionFactory = new HttpConnectionFactory(httpConfig);
    return this.createConnector(connectionFactory, options);
};

HttpServer.prototype.createSslContextFactory = function(options) {
    options = objects.merge(options || {}, {
        "includeCipherSuites": [],
        "excludeCipherSuites": [
            "SSL_RSA_WITH_DES_CBC_SHA",
            "SSL_DHE_RSA_WITH_DES_CBC_SHA", "SSL_DHE_DSS_WITH_DES_CBC_SHA",
            "SSL_RSA_EXPORT_WITH_RC4_40_MD5",
            "SSL_RSA_EXPORT_WITH_DES40_CBC_SHA",
            "SSL_DHE_RSA_EXPORT_WITH_DES40_CBC_SHA",
            "SSL_DHE_DSS_EXPORT_WITH_DES40_CBC_SHA"
        ],
        "includeProtocols": ["TLSv1", "TLSv1.1", "TLSv1.2"],
        "excludeProtocols": ["SSLv3", "SSLv2Hello"]
    });
    var sslContextFactory = new SslContextFactory();
    sslContextFactory.setKeyStorePath(options.keyStore);
    sslContextFactory.setKeyStoreType(options.keyStoreType || "JKS");
    sslContextFactory.setKeyStorePassword(options.keyStorePassword);
    sslContextFactory.setKeyManagerPassword(options.keyManagerPassword);
    sslContextFactory.setTrustStorePath(options.trustStore || options.keyStore);
    sslContextFactory.setTrustStorePassword(options.trustStorePassword ||
            options.keyStorePassword);
    sslContextFactory.setIncludeCipherSuites(options.includeCipherSuites);
    sslContextFactory.setExcludeCipherSuites(options.excludeCipherSuites);
    sslContextFactory.setIncludeProtocols(options.includeProtocols);
    sslContextFactory.setExcludeProtocols(options.excludeProtocols);
    return sslContextFactory;
};

HttpServer.prototype.createHttpsConnector = function(options) {
    options = objects.merge(options || {}, {
        "host": "0.0.0.0",
        "port": 8443,
        "sniHostCheck": true,
        "stsMaxAgeSeconds": -1,
        "stsIncludeSubdomains": false
    });
    var sslContextFactory = this.createSslContextFactory(options);
    var sslConnectionFactory = new SslConnectionFactory(sslContextFactory,
            HTTP_1_1.toString());
    var httpsConfig = this.createHttpConfig(options);
    var customizer = new SecureRequestCustomizer();
    customizer.setSniHostCheck(options.sniHostCheck === true);
    if (!isNaN(options.stsMaxAgeSeconds)) {
        customizer.setStsMaxAge(options.stsMaxAgeSeconds);
    }
    customizer.setStsIncludeSubDomains(options.stsIncludeSubdomains === true);
    httpsConfig.addCustomizer(customizer);
    var httpConnectionFactory = new HttpConnectionFactory(httpsConfig);
    return this.createConnector([sslConnectionFactory, httpConnectionFactory], options);
};

HttpServer.prototype.createHttpListener = function(options) {
    var connector = this.createHttpConnector(options);
    this.jetty.addConnector(connector);
    return connector;
};

HttpServer.prototype.createHttpsListener = function(options) {
    var connector = this.createHttpsConnector(options);
    this.jetty.addConnector(connector);
    return connector;
};

HttpServer.prototype.getHandlerCollection = function() {
    var handlerCollection = this.jetty.getHandler();
    if (handlerCollection === null) {
        handlerCollection = new HandlerCollection();
        this.jetty.setHandler(handlerCollection);
    }
    return handlerCollection;
};

HttpServer.prototype.getContextHandlerCollection = function() {
    var handlerCollection = this.getHandlerCollection();
    var contextHandlerCollection =
            handlerCollection.getChildHandlerByClass(ContextHandlerCollection);
    if (contextHandlerCollection === null) {
        contextHandlerCollection = new ContextHandlerCollection();
        handlerCollection.addHandler(contextHandlerCollection);
    }
    return contextHandlerCollection;
};

HttpServer.prototype.addContext = function(context) {
    this.contexts[context.getKey()] = context;
    this.getContextHandlerCollection().addHandler(context.contextHandler);
    if (this.jetty.isRunning()) {
        context.contextHandler.start();
    }
    return context;
};

HttpServer.prototype.enableSessions = function(options) {
    options || (options = {});
    var sessionIdManager = new HashSessionIdManager(options.random || null);
    sessionIdManager.setWorkerName(options.name || "node1");
    this.jetty.setSessionIdManager(sessionIdManager);
    return sessionIdManager;
};

HttpServer.prototype.serveApplication = function(mountpoint, app, options) {
    if (typeof(mountpoint) !== "string") {
        throw new Error("Missing mountpoint argument");
    }
    options || (options = {});
    options = {
        "security": options.security !== false,
        "sessions": options.sessions !== false,
        "cookieName": options.cookieName || null,
        "cookieDomain": options.cookieDomain || null,
        "cookiePath": options.cookiePath || null,
        "httpOnlyCookies": options.httpOnlyCookies !== false,
        "secureCookies": options.secureCookies === true,
        "statistics": options.statistics === true,
        "virtualHosts": options.virtualHosts
    };
    var context = new ApplicationContext(mountpoint, options);
    context.serve(app);
    this.addContext(context);
    return this;
};

HttpServer.prototype.serveStatic = function(mountpoint, directory, options) {
    if (typeof(mountpoint) !== "string") {
        throw new Error("Missing mountpoint argument");
    }
    if (typeof(directory) !== "string") {
        throw new Error("Missing directory argument");
    } else if (!fs.exists(directory) || !fs.isDirectory(directory)) {
        throw new Error("Directory '" + directory + "' doesn't exist or is not a directory");
    }
    options || (options = {});
    var initParameters = {
        "acceptRanges": options.acceptRanges === true,
        "dirAllowed": options.allowDirectoryListing === true,
        "gzip": options.gzip === true,
        "stylesheet": options.stylesheet || null,
        "etags": options.etags !== false,
        "maxCacheSize": options.maxCacheSize || 0,
        "maxCachedFileSize": options.maxCachedFileSize || 0,
        "maxCachedFiles": options.maxCachedFiles || 0,
        "cacheControl": options.cacheControl || null,
        "otherGzipFileExtensions": options.gzipExtensions || null
    };
    var context = new StaticContext(mountpoint, {
            "security": options.security === true,
            "sessions": options.sessions === true,
            "virtualHosts": options.virtualHosts
        });
    context.serve(directory, initParameters);
    this.addContext(context);
    return this;
};

HttpServer.prototype.serveWebSocket = function(mountpoint, app, options) {
    if (typeof(mountpoint) !== "string") {
        throw new Error("Missing mountpoint argument");
    }
    options || (options = {});
    options = {
        "security": options.security !== false,
        "sessions": options.sessions !== false,
        "cookieName": options.cookieName || null,
        "cookieDomain": options.cookieDomain || null,
        "cookiePath": options.cookiePath || null,
        "httpOnlyCookies": options.httpOnlyCookies !== false,
        "secureCookies": options.secureCookies === true,
        "statistics": options.statistics === true,
        "virtualHosts": options.virtualHosts
    };
    var context = new WebSocketContext(mountpoint, options);
    context.serve(app);
    this.addContext(context);
    return this;
}

HttpServer.prototype.start = function() {
    this.jetty.start();
    for each (let connector in this.jetty.getConnectors()) {
        log.info("Server on {}:{} started", connector.getHost(), connector.getPort());
    }
};

HttpServer.prototype.stop = function() {
    return this.jetty.stop();
};

HttpServer.prototype.destroy = function() {
    return this.jetty.destroy();
};

HttpServer.prototype.isRunning = function() {
    return this.jetty.isRunning();
};