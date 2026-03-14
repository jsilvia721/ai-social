import { pluralize } from "@/lib/pluralize";

describe("pluralize", () => {
  it("returns singular form when count is 1", () => {
    expect(pluralize(1, "account")).toBe("1 account");
  });

  it("returns plural form when count is 0", () => {
    expect(pluralize(0, "account")).toBe("0 accounts");
  });

  it("returns plural form when count is greater than 1", () => {
    expect(pluralize(2, "account")).toBe("2 accounts");
    expect(pluralize(10, "post")).toBe("10 posts");
  });

  it("uses custom plural form when provided", () => {
    expect(pluralize(0, "business", "businesses")).toBe("0 businesses");
    expect(pluralize(1, "business", "businesses")).toBe("1 business");
    expect(pluralize(5, "business", "businesses")).toBe("5 businesses");
  });
});
