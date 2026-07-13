import { expect } from "chai";
import {
  adminDeleteUserBodySchema,
  banUserBodySchema,
} from "@/utils/schemas/admin.schemas";

describe("account lifecycle reason schemas", () => {
  it("rejects reasons that become empty after sanitization", () => {
    expect(banUserBodySchema.safeParse({ reason: "<script></script>" }).success)
      .to.equal(false);
    expect(
      adminDeleteUserBodySchema.safeParse({ reason: "<script></script>" })
        .success,
    ).to.equal(false);
  });

  it("retains a meaningful sanitized reason", () => {
    const result = banUserBodySchema.parse({
      reason: "Repeated <b>spam</b> and abuse",
    });
    expect(result.reason).to.equal("Repeated spam and abuse");
  });
});
