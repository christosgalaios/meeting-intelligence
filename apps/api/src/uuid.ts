/** A canonical UUID, any case. Used to tell an id from a slug and to avoid sending junk to a uuid column. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
