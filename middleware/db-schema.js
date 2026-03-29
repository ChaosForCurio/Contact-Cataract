const { pool } = require('../db');
const onFinished = require('on-finished');
const path = require('path');
console.log('[DB_SCHEMA] Module loaded.');

/**
 * Middleware to manage user-specific database schemas for data isolation.
 * Attaches req.db with a query function scoped to the user's private schema.
 */
async function dbSchemaMiddleware(req, res, next) {
    const fs = require('fs');
    const logFile = 'd:/Coding Projects/contact-map/db-schema.log';
    const log = (msg) => console.log(`[DB_SCHEMA] ${msg}`);

    // 1. Skip if user is not authenticated (e.g. public routes)
    if (!req.user) {
        log(`No user logged in yet.`);
        req.db = {
            query: (text, params) => pool.query(text, params),
            release: () => {}
        };
        return next();
    }

    log(`User identity: ${JSON.stringify(req.user, null, 2)}`);

    if (!req.user.id) {
        log(`User missing 'id' property. Check object structure!`);
        req.db = {
            query: (text, params) => pool.query(text, params),
            release: () => {}
        };
        return next();
    }

    // 2. Derive valid Postgres schema name from UUID (underscores instead of hyphens)
    const schemaName = `user_${req.user.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    log(`Derived schema name: ${schemaName} for user: ${req.user.id}`);
    let client = null;

    req.db = {
        _client: null,
        async query(text, params) {
            if (!this._client) {
                log(`Acquiring client for schema: ${schemaName}`);
                this._client = await pool.connect();
                
                try {
                    // Ensure the private schema exists
                    await this._client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
                    log(`Schema ensured: ${schemaName}`);
                    
                    // Ensure tables exist in the private schema by cloning public templates
                    await this._client.query(`
                        CREATE TABLE IF NOT EXISTS "${schemaName}".clients (LIKE public.clients INCLUDING ALL);
                        CREATE TABLE IF NOT EXISTS "${schemaName}".relationships (LIKE public.relationships INCLUDING ALL);
                    `);
                    
                    // Set search_path for all subsequent queries in this session/request
                    await this._client.query(`SET search_path TO "${schemaName}", public`);
                    log(`search_path set to: ${schemaName}`);
                } catch (err) {
                    log(`Setup error for ${schemaName}: ${err.message}`);
                    this._client.release();
                    this._client = null;
                    throw err;
                }
            }
            log(`Executing query on ${schemaName}: ${text}`);
            return this._client.query(text, params);
        },
        release() {
            if (this._client) {
                log(`Releasing client for ${schemaName}`);
                this._client.release();
                this._client = null;
            }
        }
    };

    // 3. Ensure client is released back to pool after response
    onFinished(res, () => {
        if (req.db && req.db.release) {
            req.db.release();
        }
    });

    next();
}

module.exports = dbSchemaMiddleware;
