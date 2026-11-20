// The scheduling tables intentionally have no foreign keys, so the API has to
// verify that a referenced id belongs to the same domain before writing it.
// Without this check one practice's appointment could point at another domain's
// practitioner or service.
//
// Kept free of `@/` imports so it can be shared by route handlers and scripts.

const REFERENCE_TABLES = {
    patient_id: { table: 'patients', label: 'Patient' },
    practitioner_id: { table: 'practitioners', label: 'Practitioner' },
    location_id: { table: 'practice_locations', label: 'Practice location' },
    default_location_id: { table: 'practice_locations', label: 'Practice location' },
    service_id: { table: 'services', label: 'Service' },
    case_id: { table: 'patient_cases', label: 'Patient case' },
}

/**
 * Return one error message per reference field whose id is not present in the
 * requested domain. Missing/null ids are ignored.
 */
export async function findInvalidDomainReferences(connection, domain, fields = {}) {
    const errors = []

    for (const [key, reference] of Object.entries(REFERENCE_TABLES)) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
        const id = fields[key]
        if (id === null || id === undefined) continue

        const table = await connection.query('SELECT to_regclass($1) AS reg', [reference.table])
        if (!table.rows?.[0]?.reg) {
            errors.push(`${reference.label} ${id} cannot be verified because the table is missing`)
            continue
        }

        const result = await connection.query(
            `SELECT 1 FROM ${reference.table} WHERE id = $1 AND domain = $2 LIMIT 1`,
            [id, domain]
        )
        if (!result.rows?.length) {
            errors.push(`${reference.label} ${id} does not belong to this domain`)
        }
    }

    return errors
}
