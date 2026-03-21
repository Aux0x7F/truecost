export function formatWorkspaceKarma(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "0";
  return score > 0 ? `+${score}` : String(score);
}

export function karmaBucketMatches(score, bucket) {
  if (!bucket) return true;
  if (bucket === "lt0") return score < 0;
  if (bucket === "0-5") return score >= 0 && score <= 5;
  if (bucket === "6-50") return score >= 6 && score <= 50;
  if (bucket === "51-500") return score >= 51 && score <= 500;
  if (bucket === "gt500") return score > 500;
  return true;
}

export function karmaBucketForScore(score) {
  if (score < 0) return "lt0";
  if (score <= 5) return "0-5";
  if (score <= 50) return "6-50";
  if (score <= 500) return "51-500";
  return "gt500";
}

export function renderKarmaSelectOptions(selectedValue) {
  const current = String(selectedValue || "").trim().toLowerCase();
  const options = [
    ["", "All karma"],
    ["lt0", "Below 0"],
    ["0-5", "0 to 5"],
    ["6-50", "6 to 50"],
    ["51-500", "51 to 500"],
    ["gt500", "Above 500"]
  ];
  return options
    .map(([value, label]) => `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

export function renderRoleSelectOptions(selectedValue) {
  const current = String(selectedValue || "").trim().toLowerCase();
  const options = [
    ["", "All roles"],
    ["admin", "Admin"],
    ["member", "Member"],
    ["removed", "Removed"]
  ];
  return options
    .map(([value, label]) => `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

export function commentToneState(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore > -1) {
    return { tone: "clear", amount: "0%" };
  }
  if (numericScore <= -5) {
    return { tone: "danger", amount: "50%" };
  }
  return numericScore <= -3
    ? { tone: "caution", amount: "50%" }
    : { tone: "caution", amount: `${Math.round((Math.abs(numericScore) / 5) * 50)}%` };
}

export function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
