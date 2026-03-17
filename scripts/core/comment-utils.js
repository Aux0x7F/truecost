export function dedupeRecordsById(records, idKey = "id") {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter((record) => {
    const id = String(record?.[idKey] || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function collectRecordBranchIds(records, rootId, {
  idKey = "id",
  parentKey = "parent_id"
} = {}) {
  const children = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const parentId = String(record?.[parentKey] || "").trim();
    const recordId = String(record?.[idKey] || "").trim();
    if (!parentId || !recordId) continue;
    const bucket = children.get(parentId) || [];
    bucket.push(recordId);
    children.set(parentId, bucket);
  }
  const ids = [];
  const stack = [String(rootId || "").trim()];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    for (const childId of children.get(current) || []) stack.push(childId);
  }
  return ids;
}

export function regroupRecordsByKey(records, key) {
  const buckets = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const bucketKey = String(record?.[key] || "").trim();
    if (!bucketKey) continue;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(record);
    buckets.set(bucketKey, bucket);
  }
  return buckets;
}
