var log = require("ringo/logging").getLogger(module.id);
var Context = require("./context");
var {JsgiServlet} = org.ringojs.jsgi;
var {WebSocketServlet, WebSocketCreator} = org.eclipse.jetty.websocket.servlet;
var WebSocket = require("../websocket");

var WebSocketContext = module.exports = function WebSocketContext() {
    Context.apply(this, arguments);
    return this;
};

WebSocketContext.prototype = Object.create(Context.prototype);
WebSocketContext.prototype.constructor = WebSocketContext;

WebSocketContext.prototype.serve = function(app, initParams) {
    log.info("Starting websocket support");

    if (app == null) {
        throw new Error("Missing application to serve");
    } else if (typeof(app) === "string") {
        app = require(app);
    } else if (typeof(app) !== "function") {
        throw new Error("Application must be either a function or the path " +
                "to a module exporting the functions onConnect and optionally onCreate");
    }

    var webSocketCreator = new WebSocketCreator({
        "createWebSocket": function(request, response) {
            if (typeof(app) === "object" &&
                typeof(app.onCreate) === "function" &&
                app.onCreate(request, response) !== true) {
                return null;
            }
            var socket = new WebSocket();
            socket.addListener("connect", function(session) {
                socket.session = session;
                if (typeof app === "function") {
                    app(socket, session);
                } else if (typeof app === "object" && typeof app.onConnect === "function") {
                    app.onConnect(socket, session);
                }
            });

            return socket.impl;
        }
    });

    this.addServlet('/*', new WebSocketServlet({
        "configure": function(factory) {
            factory.setCreator(webSocketCreator);
        }
    }), initParams);
    return;
};