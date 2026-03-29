const { StackClientApp } = require("@stackframe/js");

const stackClientApp = new StackClientApp({
  projectId: process.env.Stack_Project_ID,
  tokenStore: "cookie",
});

module.exports = { stackClientApp };
