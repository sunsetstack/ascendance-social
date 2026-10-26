const conversationId = "33333333-3333-4333-8333-333333333333";
const base = `/api/messaging/conversations/${conversationId}`;
const user = {
  publicId: "11111111-1111-4111-8111-111111111111",
  username: "Alice",
  handle: "alice",
  avatar: "",
};
const partner = {
  publicId: "22222222-2222-4222-8222-222222222222",
  username: "Bob",
  handle: "bob",
  avatar: "",
};

describe("Conversation controls browser regression (HTTP responses simulated)", () => {
  let visible: boolean;
  let locked: boolean;
  let actions: string[];

  beforeEach(() => {
    visible = true;
    locked = false;
    actions = [];
    cy.intercept("GET", "**/api/messaging/conversations?*", (req) => {
      req.reply({
        conversations: visible
          ? [
              {
                publicId: conversationId,
                participants: [user, partner],
                unreadCount: 0,
                isGroup: false,
                isLocked: locked,
                lastMessage: null,
              },
            ]
          : [],
        total: visible ? 1 : 0,
        page: 1,
        limit: 20,
        totalPages: visible ? 1 : 0,
      });
    }).as("conversations");
    cy.intercept("GET", `**${base}/messages?*`, (req) =>
      req.reply(
        visible
          ? {
              messages: [
                {
                  publicId: "44444444-4444-4444-8444-444444444444",
                  conversationId,
                  body: "Original message",
                  sender: user,
                  attachments: [],
                  status: "sent",
                  readBy: [],
                  createdAt: "2026-10-19T09:00:00.000Z",
                },
              ],
              total: 1,
              page: 1,
              limit: 50,
              totalPages: 1,
            }
          : { statusCode: 404, body: { message: "Conversation not found" } },
      ),
    ).as("messages");
    cy.intercept("POST", `**${base}/read`, { statusCode: 204 });
    cy.intercept("POST", `**${base}/lock`, (req) => {
      locked = true;
      actions.push("lock");
      req.reply(204);
    }).as("lock");
    cy.intercept("DELETE", `**${base}/lock`, (req) => {
      locked = false;
      actions.push("unlock");
      req.reply(204);
    }).as("unlock");
    cy.intercept("DELETE", `**${base}`, (req) => {
      visible = false;
      actions.push("delete");
      req.reply(204);
    }).as("delete");
    cy.intercept("DELETE", `**${base}/purge`, (req) => {
      visible = false;
      actions.push("purge");
      req.reply(204);
    }).as("purge");
    cy.intercept("GET", "**/api/notifications*", { body: [] });
  });

  function visit(admin = false, mobile = false) {
    cy.viewport(mobile ? 390 : 1280, mobile ? 844 : 800);
    cy.visit(
      `/cypress/fixtures/conversation-controls.html?admin=${admin ? 1 : 0}`,
    );
    cy.wait("@conversations");
    cy.contains("li", "Bob").should("be.visible");
  }
  const row = () => cy.contains("li", "Bob");
  const confirm = (label: string) =>
    cy
      .get('[role="dialog"]')
      .contains("button", new RegExp(`^${label}$`))
      .click();
  function swipe() {
    row().trigger("pointerdown", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 300,
      clientY: 200,
    });
    row().trigger("pointermove", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 180,
      clientY: 204,
    });
    row().trigger("pointerup", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 180,
      clientY: 204,
    });
  }

  it("deletes through the desktop context menu and removes the open history", () => {
    visit();
    cy.wait("@messages");
    cy.contains("Original message").should("be.visible");
    row().rightclick();
    cy.contains('[role="menuitem"]', "Delete conversation").click();
    cy.get('[role="dialog"]').should(
      "contain.text",
      "other participant keeps their copy",
    );
    confirm("Delete");
    cy.wait("@delete");
    cy.contains("Original message").should("not.exist");
    cy.contains("Welcome to your inbox!").should("be.visible");
    cy.then(() => expect(actions).to.deep.equal(["delete"]));
  });

  it("keeps admin options out of a participant's menu", () => {
    visit();
    row().rightclick();
    cy.contains('[role="menuitem"]', "Delete conversation").should(
      "be.visible",
    );
    cy.contains('[role="menuitem"]', "Purge conversation").should("not.exist");
    cy.contains('[role="menuitem"]', "Lock conversation").should("not.exist");
  });

  it("locks and unlocks from the admin menu and updates the composer", () => {
    visit(true);
    cy.wait("@messages");
    row().rightclick();
    cy.contains('[role="menuitem"]', "Lock conversation").click();
    confirm("Lock");
    cy.wait("@lock");
    cy.get('input[placeholder="Write a message"]').should("be.disabled");
    cy.contains('[role="alert"]', "Conversation locked by admin").should(
      "be.visible",
    );
    cy.contains("Original message").should("be.visible");
    row().rightclick();
    cy.contains('[role="menuitem"]', "Delete conversation").should(
      "have.attr",
      "aria-disabled",
      "true",
    );
    cy.contains('[role="menuitem"]', "Unlock conversation").click();
    confirm("Unlock");
    cy.wait("@unlock");
    cy.get('input[placeholder="Write a message"]').should("not.be.disabled");
    cy.then(() => expect(actions).to.deep.equal(["lock", "unlock"]));
  });

  it("purges from the desktop admin menu only after explicit confirmation", () => {
    visit(true);
    row().rightclick();
    cy.contains('[role="menuitem"]', "Purge conversation").click();
    cy.get('[role="dialog"]').should("contain.text", "every participant");
    confirm("Purge");
    cy.wait("@purge");
    cy.contains("li", "Bob").should("not.exist");
    cy.then(() => expect(actions).to.deep.equal(["purge"]));
  });

  it("reveals Delete by mobile swipe without opening the conversation", () => {
    visit(false, true);
    swipe();
    cy.location("search").should("not.contain", "conversation=");
    row()
      .contains("button", /^Delete$/)
      .should("be.visible")
      .click();
    confirm("Delete");
    cy.wait("@delete");
    cy.contains("li", "Bob").should("not.exist");
    cy.then(() => expect(actions).to.deep.equal(["delete"]));
  });

  it("opens admin options on mobile hold and accepts the first menu tap", () => {
    visit(true, true);
    row().trigger("pointerdown", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    cy.wait(600);
    row().trigger("pointerup", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      force: true,
    });
    cy.contains('[role="menuitem"]', "Purge conversation").click();
    cy.get('[role="dialog"]').should("be.visible");
    cy.location("search").should("not.contain", "conversation=");
    confirm("Purge");
    cy.wait("@purge");
  });

  it("cancels mobile hold on vertical movement without revealing deletion", () => {
    visit(true, true);
    row().trigger("pointerdown", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    row().trigger("pointermove", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
      clientX: 202,
      clientY: 230,
    });
    row().trigger("pointerup", {
      eventConstructor: "PointerEvent",
      pointerType: "touch",
      pointerId: 1,
    });
    cy.wait(600);
    cy.get('[role="menu"]').should("not.exist");
    row()
      .contains("button", /^Delete$/)
      .should("not.be.visible");
    cy.then(() => expect(actions).to.deep.equal([]));
  });

  it("does not reveal deletion for a locked mobile conversation", () => {
    locked = true;
    visit(false, true);
    swipe();
    row()
      .contains("button", /^Delete$/)
      .should("not.be.visible");
    row().find('button[aria-label="Conversation options"]').click();
    cy.contains('[role="menuitem"]', "Delete conversation").should(
      "have.attr",
      "aria-disabled",
      "true",
    );
    cy.then(() => expect(actions).to.deep.equal([]));
  });

  it("keeps the dialog and conversation intact when the server rejects purge", () => {
    cy.intercept("DELETE", `**${base}/purge`, {
      statusCode: 403,
      body: { message: "Admin privileges required" },
    }).as("denied");
    visit(true);
    row().rightclick();
    cy.contains('[role="menuitem"]', "Purge conversation").click();
    confirm("Purge");
    cy.wait("@denied");
    cy.get('[role="dialog"]').should(
      "contain.text",
      "Admin privileges required",
    );
    cy.contains("li", "Bob").should("exist");
    cy.then(() => expect(actions).to.deep.equal([]));
  });

  it("cancels deletion without changing the conversation", () => {
    visit();
    row()
      .find('button[aria-label="Conversation options"]')
      .focus()
      .should("be.focused")
      .click();
    cy.contains('[role="menuitem"]', "Delete conversation").click();
    confirm("Cancel");
    cy.get('[role="dialog"]').should("not.exist");
    cy.contains("li", "Bob").should("be.visible");
    cy.then(() => expect(actions).to.deep.equal([]));
  });
});
