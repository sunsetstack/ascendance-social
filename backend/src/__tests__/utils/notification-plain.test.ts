import { expect } from "chai";
import Notification from "@/models/notification.model";
import { normalizeNotificationPlain, requireNotificationRecord } from "@/utils/notification-plain";

describe("Notification records", () => {
  const timestamp = new Date("2026-10-27T12:00:00.000Z");
  const valid = { id: "notification", userId: "receiver", actorId: "actor", actionType: "follow", isRead: false, timestamp };

  it("normalizes real Mongoose documents and plain repository results into the same shape", () => {
    const document = new Notification({ ...valid, id: undefined });
    const fromDocument = requireNotificationRecord(document);
    const fromPlain = requireNotificationRecord(document.toObject());
    expect(fromDocument).to.deep.equal(fromPlain);
    expect(fromDocument.id).to.equal(String(document._id));
    expect(fromDocument).not.to.have.property("$__");
  });

  it("keeps date and unread-state compatibility for serialized cache input", () => {
    expect(normalizeNotificationPlain({ ...valid, timestamp: timestamp.toISOString(), isRead: "0" })).to.deep.equal(valid);
  });

  for (const value of [null, [], {}, { ...valid, id: "" }, { ...valid, userId: "" }, { ...valid, actorId: undefined },
    { ...valid, timestamp: "invalid" }, { ...valid, isRead: "false" }, { ...valid, timestamp: new Date(NaN) }]) {
    it(`rejects an incomplete or malformed record ${JSON.stringify(value)}`, () => {
      expect(normalizeNotificationPlain(value)).to.equal(null);
      expect(() => requireNotificationRecord(value)).to.throw("Invalid persisted notification record");
    });
  }
});
