// js/functions.js
import { renderFromSpec } from "./output_renderer.js";

export const functionDefinitions = {
  render_plotly_chart: {
    name: "render_plotly_chart",
    description: "Render a Plotly chart from the given spec and capture it to the Visuals gallery.",
    parameters: {
      type: "object",
      properties: {
        spec: {
          type: "object",
          description: "DAIS chart spec",
          properties: {
            dataUrl: { type: "string" },
            chartType: { type: "string", enum: ["bar","line","scatter","pie"] },
            mappings: {
              type: "object",
              properties: {
                x: { type: "string" },
                y: { type: "string" },
                color: { type: ["string","null"] },
                yOp: { type: "string", enum: ["sum","mean","count","min","max"] }
              },
              required: ["x"]
            },
            format: {
              type: "object",
              properties: {
                title: { type: "string" },
                xTitle: { type: "string" },
                yTitle: { type: "string" }
              }
            },
            drilldown: {
              type: "object",
              description: "Optional explicit drill path. Omit to auto-infer.",
              properties: {
                path: { type: "array", items: { type: "string" } }
              }
            },
            fileName: { type: "string" }
          },
          required: ["chartType","mappings"]
        },
        showFullView: { type: "boolean", default: true }
      },
      required: ["spec"]
    }
  }
};

// Implementations
export const functionImplementations = {
  async render_plotly_chart({ spec, showFullView = true }) {
    // Ensure full-view modal exists (created by visuals_gallery.js), then render.
    const modalEl = document.getElementById("fullViewModal");
    const titleEl = document.getElementById("fvTitle");
    const containerSel = "#fvContainer";

    if (!modalEl) throw new Error("Full View modal not found");
    if (titleEl) titleEl.textContent = spec?.format?.title || "Full View";

    if (showFullView) {
      const bsModal = new bootstrap.Modal(modalEl);
      bsModal.show();
    }

    await renderFromSpec(spec, containerSel);
    return `Rendered "${spec?.format?.title || spec?.fileName || "chart"}" and saved to Visuals.`;
  }
};

export async function executeFunction(name, args) {
  const fn = functionImplementations[name];
  if (!fn) throw new Error(`Unknown function: ${name}`);
  return await fn(args || {});
}
