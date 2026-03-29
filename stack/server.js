const { StackServerApp } = require("@stackframe/js");

const stackServerApp = new StackServerApp({
  projectId: process.env.Stack_Project_ID,
  secretServerKey: process.env.Stack_Secret_Server_Key,
  tokenStore: "cookie",
});

module.exports = { stackServerApp };
