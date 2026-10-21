// Everything SnapBuy can do, grouped by what people come to do. Photo tools
// share one page (the photo is used for the chosen purpose).
export const TOOL_GROUPS = [
  {
    title: "Find & save",
    tools: [
      { key: "photo", icon: "camera", title: "Search by photo", text: "Snap or upload a product; see every store and the cheapest price." },
      { key: "list", icon: "bag", title: "Shop my list", text: "Photograph or type a shopping list and get every item in one cart." },
      { key: "watch", icon: "bell", title: "Price watch", text: "Tap the bell on any product and we'll tell you when it gets cheaper." },
    ],
  },
  {
    title: "Style me",
    tools: [
      { key: "outfit", icon: "shirt", title: "Find the outfit", text: "Shop every item someone is wearing in a photo." },
      { key: "rate", icon: "star", title: "Rate my outfit", text: "A style score out of 10, with tips you can shop." },
      { key: "colours", icon: "palette", title: "Colours that suit me", text: "One selfie tells us the colours that flatter you." },
      { key: "tryon", icon: "sparkles", title: "Try it on", text: "See clothes, glasses or a watch on your own photo." },
    ],
  },
  {
    title: "Plan & gift",
    tools: [
      { key: "plan", icon: "tag", title: "Plan a look on a budget", text: "A complete outfit for any occasion that fits your budget." },
      { key: "gift", icon: "heart", title: "Find a gift", text: "Six thoughtful gift ideas for anyone, at any budget." },
      { key: "room", icon: "box", title: "Shop a room", text: "Find the furniture and decor from any room photo." },
    ],
  },
];

export const TOOLS = Object.fromEntries(TOOL_GROUPS.flatMap((group) => group.tools).map((tool) => [tool.key, tool]));
