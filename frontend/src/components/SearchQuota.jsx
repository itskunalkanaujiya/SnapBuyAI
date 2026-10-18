import { useEffect, useState } from "react";
import { API_URL } from "../lib/products.js";

const LOW_SHARE = 0.1; // warn when this share of the month's searches is left

function formatRenewal(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Searches left this month on the SerpApi plan that powers photo and text
 * search. Read again whenever `refreshKey` changes (after each search).
 * Renders nothing if the count can't be read.
 */
export default function SearchQuota({ refreshKey }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/api/v1/usage`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => active && setUsage(data))
      .catch(() => active && setUsage(null));
    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (!usage || typeof usage.searches_left !== "number" || !usage.searches_per_month) {
    return null;
  }

  const { searches_left: left, searches_per_month: total, renews_on: renewsOn } = usage;
  const share = Math.max(0, Math.min(1, left / total));
  const level = left <= 0 ? "empty" : share <= LOW_SHARE ? "low" : "ok";
  const renewal = renewsOn ? formatRenewal(renewsOn) : "";

  return (
    <div className={`search-quota quota-${level}`} title="Photo and text searches left on this month's search plan">
      <div className="search-quota-head">
        <span>
          <strong>{left.toLocaleString("en-IN")}</strong> of {total.toLocaleString("en-IN")} searches left
        </span>
        {renewal && <span className="search-quota-renew">Renews {renewal}</span>}
      </div>
      <div
        className="search-quota-track"
        role="meter"
        aria-label="Searches left this month"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
      >
        <span style={{ width: `${share * 100}%` }} />
      </div>
      {level !== "ok" && (
        <p className="search-quota-note">
          {left <= 0
            ? "This month's searches are used up. Searches you've already run still load from the cache."
            : "Running low on searches this month."}
        </p>
      )}
    </div>
  );
}
