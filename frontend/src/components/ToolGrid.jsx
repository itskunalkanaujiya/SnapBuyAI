import Icon from "./Icon.jsx";
import { TOOL_GROUPS } from "../lib/tools.js";

/** "What would you like to do?": every tool as a card. */
export default function ToolGrid({ onOpen }) {
  return (
    <section className="tool-hub container" aria-labelledby="tool-hub-title">
      <h2 id="tool-hub-title">What would you like to do?</h2>
      <div className="tool-groups">
        {TOOL_GROUPS.map((group) => (
          <div key={group.title} className="tool-group">
            <h3>{group.title}</h3>
            <ul>
              {group.tools.map((tool) => (
                <li key={tool.key}>
                  <button type="button" className="tool-card" onClick={() => onOpen(tool.key)}>
                    <span className="tool-card-icon" aria-hidden="true">
                      <Icon name={tool.icon} size={20} />
                    </span>
                    <span className="tool-card-text">
                      <strong>{tool.title}</strong>
                      <small>{tool.text}</small>
                    </span>
                    <Icon name="arrowRight" size={16} className="tool-card-arrow" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
