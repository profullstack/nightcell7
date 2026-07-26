import { describe, expect, it } from "vitest";
import { copyButtonLabel, summarizeCommand } from "./copy-command-label";

describe("copy button accessible name", () => {
  it("names the command it copies, so fourteen buttons are not all 'Copy'", () => {
    expect(copyButtonLabel("Install", "brew install --cask nightcell7")).toBe(
      "Copy Install command: brew install --cask nightcell7",
    );
  });

  it("works without a label", () => {
    expect(copyButtonLabel(undefined, "nightcell7 login")).toBe("Copy command: nightcell7 login");
  });

  it("clips a long command rather than reciting it", () => {
    const long = `curl -fsSLO https://github.com/profullstack/nightcell7/releases/latest/download/SHA256SUMS.txt`;
    const name = copyButtonLabel("Verify", long);
    expect(name.length).toBeLessThan(long.length);
    expect(name).toContain("…");
    expect(name.startsWith("Copy Verify command: curl -fsSLO https://github.com")).toBe(true);
  });

  it("signals extra lines instead of reading the whole block", () => {
    const multi = `nightcell7 update
# or, without it installed:
curl -fsSL https://nightcell7.com/install.sh | sh -s -- update`;
    expect(summarizeCommand(multi)).toBe("nightcell7 update, and more");
  });

  it("falls back to the label when there is nothing to summarize", () => {
    expect(copyButtonLabel("Install", "   ")).toBe("Copy Install command");
    expect(copyButtonLabel(undefined, "")).toBe("Copy command");
  });

  it("leaves a short single-line command untouched", () => {
    expect(summarizeCommand("nightcell7 version")).toBe("nightcell7 version");
  });
});
