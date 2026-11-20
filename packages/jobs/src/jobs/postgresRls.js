function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`
}

/**
 * Let the worker drain a queue table it owns the schema for.
 *
 * The policy is created `TO CURRENT_USER`, not for `PUBLIC`: PostgreSQL ORs every
 * policy that applies to a row, so a `USING (true)` policy granted to PUBLIC
 * silently widens every other role's access to the table — including the app's
 * constrained runtime role, which relies on its own domain policy to keep patient
 * records inside one tenant. Scoping it to the connecting role keeps this worker's
 * access and leaves everyone else's isolation intact. `CURRENT_USER` binds the role
 * that runs the statement, so a pooled session that has assumed the worker's role
 * still gets the policy for the role it actually queries as.
 */
export async function ensurePermissiveRowLevelSecurity(connection, tableName, policyName) {
    if (!connection?.query) return false
    if (!tableName) return false

    const qualifiedTable = quoteIdentifier(tableName)
    const resolvedPolicyName = String(policyName || `${tableName}_access_policy`).trim()
    const quotedPolicyName = quoteIdentifier(resolvedPolicyName)

    await connection.query(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`)
    await connection.query(`DROP POLICY IF EXISTS ${quotedPolicyName} ON ${qualifiedTable}`)
    await connection.query(`CREATE POLICY ${quotedPolicyName} ON ${qualifiedTable} FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true)`)

    return true
}