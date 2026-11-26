import { describe, expect, it } from "vitest";
import { findUi, firstDevice, inputTextPieces, parseUi, phoneFileName, pickResult, screenSize, shellQuote, streamSize, typeable } from "../../desktop/lib/phone.mjs";

describe("reading adb's answers", () => {
  it("picks a ready emulator and never a real phone", () => {
    expect(firstDevice("List of devices attached\nemulator-5554\tdevice\n")).toBe("emulator-5554");
    expect(firstDevice("List of devices attached\nR58M123\tdevice\nemulator-5554\tdevice\n")).toBe("emulator-5554");
    expect(firstDevice("List of devices attached\nemulator-5554\toffline\n")).toBeNull();
    expect(firstDevice("")).toBeNull();
    expect(firstDevice("List of devices attached\nR58M123\tdevice\n")).toBeNull();
    expect(firstDevice("List of devices attached\nR58M123\tdevice\nemulator-5554\toffline\n")).toBeNull();
    expect(firstDevice("List of devices attached\nemulator-5554\toffline\nemulator-5556\tdevice\n")).toBe("emulator-5556");
    expect(firstDevice("List of devices attached\n192.168.1.20:5555\tdevice\n")).toBeNull();
  });

  it("reads the screen size, an override winning", () => {
    expect(screenSize("Physical size: 1080x2424")).toEqual({ width: 1080, height: 2424 });
    expect(screenSize("Physical size: 1080x2424\nOverride size: 720x1600")).toEqual({ width: 720, height: 1600 });
    expect(screenSize("nonsense")).toBeNull();
  });

  it("streams at a smaller, even size", () => {
    expect(streamSize({ width: 1080, height: 2424 }, 1212)).toEqual({ width: 540, height: 1212 });
    expect(streamSize({ width: 360, height: 640 }, 1212)).toEqual({ width: 360, height: 640 });
    const odd = streamSize({ width: 1081, height: 2401 }, 1000);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });
});

describe("what is sent to the phone's shell", () => {
  it("makes a safe file name", () => {
    expect(phoneFileName("My Reel #4 (final).mp4")).toBe("My-Reel-4-final.mp4");
    expect(phoneFileName("")).toBe("nocap-edit.mp4");
    const sneaky = phoneFileName("../../etc/passwd");
    expect(sneaky).not.toContain("/");
    expect(sneaky.endsWith(".mp4")).toBe(true);
  });

  it("quotes anything that is not plainly safe", () => {
    expect(shellQuote("abc-1.2")).toBe("abc-1.2");
    expect(shellQuote("two words")).toBe("'two words'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("$(reboot)")).toBe("'$(reboot)'");
    expect(shellQuote("a;b")).toBe("'a;b'");
  });

  it("keeps only what the phone can type", () => {
    expect(typeable("a’b — c")).toEqual({ lines: ["a'b - c"], dropped: [] });
    const emoji = typeable("hi \u{1F3A4} there \u{1F3A4}");
    expect(emoji.dropped).toEqual(["\u{1F3A4}"]);
    expect(emoji.lines.join("")).not.toContain("\u{1F3A4}");
    expect(typeable("one\r\ntwo").lines).toEqual(["one", "two"]);
  });

  it("types spaces as %s without turning the user's own %s into a space", () => {
    expect(inputTextPieces("a b")).toEqual(["a%sb"]);
    const pieces = inputTextPieces("50%s off");
    expect(pieces).toHaveLength(2);
    expect(pieces[0].endsWith("%")).toBe(true);
    expect(pieces[1].startsWith("s")).toBe(true);
    expect(inputTextPieces("")).toEqual([]);
  });
});

describe("finding things on the phone's screen", () => {
  const xml = [
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`,
    `<node index="0" text="" resource-id="com.instagram.android:id/share_button" class="android.widget.Button" package="com.instagram.android" content-desc="Next" checkable="false" clickable="true" bounds="[561,2192][1038,2308]" />`,
    `<node index="1" text="Hidden" resource-id="" class="android.widget.TextView" package="com.instagram.android" content-desc="" checkable="false" clickable="false" bounds="[0,0][0,0]" />`,
    `<node index="2" text="Tom &amp; Jerry" resource-id="com.instagram.android:id/row_venue_title" class="android.widget.TextView" package="com.instagram.android" content-desc="" checkable="false" clickable="false" bounds="[42,741][622,788]" />`,
    `</hierarchy>`,
  ].join("");
  const nodes = parseUi(xml);

  it("lists the elements that are on screen", () => {
    expect(nodes).toHaveLength(2);
    const share = nodes[0];
    expect(share.id).toBe("share_button");
    expect(share.cls).toBe("Button");
    expect(share.clickable).toBe(true);
    expect(share.x).toBeGreaterThanOrEqual(799);
    expect(share.x).toBeLessThanOrEqual(800);
    expect(share.y).toBe(2250);
    expect(nodes[1].text).toBe("Tom & Jerry");
  });

  it("finds by id, text or description", () => {
    expect(findUi(nodes, { desc: "next" })?.id).toBe("share_button");
    expect(findUi(nodes, { id: "share_button", desc: "Share" })).toBeNull();
    expect(findUi(nodes, { id: "nope" })).toBeNull();
  });

  it("picks the exact search result, else the first", () => {
    expect(pickResult(nodes, "row_venue_title", "tom & jerry")?.text).toBe("Tom & Jerry");
    expect(pickResult(nodes, "row_venue_title", "something else")?.text).toBe("Tom & Jerry");
    expect(pickResult(nodes, "row_other", "x")).toBeNull();
  });
});
