var log = require("ringo/logging").getLogger(module.id);
var Context = require("./context");
var {JsgiServlet} = org.ringojs.jsgi;

var ApplicationContext = module.exports = function ApplicationContext() {
    Context.apply(this, arguments);
    return this;
};

ApplicationContext.prototype = Object.create(Context.prototype);
ApplicationContext.prototype.constructor = ApplicationContext;

ApplicationContext.prototype.serve = function(app, engine) {
    log.info("Adding JSGI application {} -> {}",
            this.contextHandler.getContextPath(), app);
    engine = engine || require("ringo/engine").getRhinoEngine();
    if (app == null) {
        throw new Error("Missing application to serve");
    } else if (typeof(app) === "string") {
        app = require(app);
    } else if (typeof(app) !== "function") {
        throw new Error("Application must be either a function or the path " +
                "to a module exporting a function");
    }
    this.addServlet("/*", new JsgiServlet(engine, app))
    return;
};
