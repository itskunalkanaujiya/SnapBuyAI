import { useState } from "react";
import Icon from "./Icon.jsx";

const AUDIENCES = [
  { key: "", label: "Anyone" },
  { key: "men", label: "Men" },
  { key: "women", label: "Women" },
  { key: "kids", label: "Kids" },
];

const EXAMPLES = [
  { request: "Wedding guest outfit", gender: "men", budget: 5000 },
  { request: "College fest look", gender: "women", budget: 2000 },
  { request: "Office formals for the first day", gender: "men", budget: 4000 },
  { request: "Diwali party look", gender: "women", budget: 3500 },
];

/**
 * Budget look planner: the occasion, who it's for and the budget. AI plans
 * the whole look and keeps the total within the budget.
 */
export default function PlanPanel({ modeTabs, onPlan, isPlanning, error }) {
  const [request, setRequest] = useState("");
  const [budget, setBudget] = useState("");
  const [gender, setGender] = useState("");

  const ready = request.trim().length >= 3 && (Number(budget) > 0 || /\d/.test(request));

  function submit(next) {
    const plan = next || { request: request.trim(), budget: Number(budget) || null, gender };
    if (next) {
      setRequest(next.request);
      setBudget(String(next.budget));
      setGender(next.gender);
    }
    onPlan(plan);
  }

  return (
    <div className="panel search-panel plan-panel">
      {modeTabs}

      <div className="panel-header">
        <div>
          <h2>Plan a look on a budget</h2>
          <p>Tell us the occasion and budget; AI plans every piece and keeps the total in budget.</p>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !isPlanning) submit();
        }}
      >
        <label className="plan-label" htmlFor="plan-request">
          What's the occasion?
        </label>
        <input
          id="plan-request"
          className="plan-input"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="e.g. Wedding guest outfit, college fest, office party"
          maxLength={150}
        />

        <div className="plan-row">
          <div>
            <span className="plan-label">For</span>
            <div className="plan-audience" role="radiogroup" aria-label="Who it's for">
              {AUDIENCES.map((audience) => (
                <button
                  key={audience.key}
                  type="button"
                  role="radio"
                  aria-checked={gender === audience.key}
                  className={gender === audience.key ? "is-active" : ""}
                  onClick={() => setGender(audience.key)}
                >
                  {audience.label}
                </button>
              ))}
            </div>
          </div>
          <div className="plan-budget">
            <span className="plan-label">Total budget</span>
            <label className="field field-price">
              <span aria-hidden="true">₹</span>
              <input
                type="number"
                min="300"
                step="100"
                inputMode="numeric"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="5000"
                aria-label="Total budget in rupees"
              />
            </label>
          </div>
        </div>

        <button type="submit" className="button button-primary button-lg search-button" disabled={!ready || isPlanning}>
          {isPlanning ? (
            <>
              <span className="spinner spinner-light" />
              Planning your look…
            </>
          ) : (
            <>
              <Icon name="sparkles" size={18} />
              Plan my look
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={17} />
          <span>{error}</span>
        </div>
      )}

      <div className="text-examples">
        <span>Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.request}
            type="button"
            className="example-chip"
            onClick={() => submit(example)}
            disabled={isPlanning}
          >
            {example.request}, {example.gender}, ₹{example.budget.toLocaleString("en-IN")}
          </button>
        ))}
      </div>

      <p className="panel-footnote">
        <Icon name="tag" size={13} />
        AI splits the budget across the pieces and picks one listing for each, keeping the total
        within your budget. Swap any piece and the total updates.
      </p>
    </div>
  );
}
