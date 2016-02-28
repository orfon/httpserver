var httpServer = require("../lib/main");
var builder = httpServer.build()
        // enable sessions with a custom node name
        .enableSessions({
            "name": "test1"
        })
        // serve application
        .serveApplication("/myapp", module.resolve("./app"))
        // add websockets
        .serveWebSocket("/websocket", module.resolve('./websocket'))
        .serveWebSocket("/another-ws", function() {})
        // static file serving
        .serveStatic("/static", module.resolve("./"), {
            "allowDirectoryListing": true
        })
        // http listener
        .http({
            "port": 8080
        })
        // https listener
        .https({
            "port": 8443,
            "keyStore": module.resolve("./keystore"),
            "keyStorePassword": "secret",
            "keyManagerPassword": "secret"
        })
        // start up the server
        .start();
