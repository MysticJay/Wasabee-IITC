import { WDialog } from "../leafletClasses";
import Sortable from "../../lib/sortable";
import { getSelectedOperation } from "../selectedOp";
import WasabeeTeam from "../team";
import WasabeeMe from "../me";
import { addPermPromise, delPermPromise } from "../server";
import wX from "../wX";
import { postToFirebase } from "../firebaseSupport";

const OpPermList = WDialog.extend({
  statics: {
    TYPE: "opPermList",
  },

  initialize: function (map = window.map, options) {
    this.type = OpPermList.TYPE;
    WDialog.prototype.initialize.call(this, map, options);
    postToFirebase({ id: "analytics", action: OpPermList.TYPE });
  },

  addHooks: async function () {
    if (!this._map) return;
    WDialog.prototype.addHooks.call(this);
    this._operation = getSelectedOperation();
    if (WasabeeMe.isLoggedIn()) {
      this._me = await WasabeeMe.waitGet();
    } else {
      this._me = null;
    }
    const context = this;
    this._UIUpdateHook = (newOpData) => {
      context.update(newOpData);
    };
    window.addHook("wasabeeUIUpdate", this._UIUpdateHook);

    this._displayDialog();
  },

  removeHooks: function () {
    window.removeHook("wasabeeUIUpdate", this._UIUpdateHook);
    WDialog.prototype.removeHooks.call(this);
  },

  update: async function (op) {
    // logged in while dialog open...
    if (!this._me && WasabeeMe.isLoggedIn()) {
      this._me = await WasabeeMe.waitGet();
    }

    this._operation = op;
    this.buildTable();
    this._html.firstChild.replaceWith(this._table.table);
  },

  _displayDialog: function () {
    if (!this._map) return;

    this.buildTable();

    this._html = L.DomUtil.create("div", null);

    this._html.appendChild(this._table.table);
    if (this._me && this._operation.IsOwnedOp()) {
      const addArea = L.DomUtil.create("div", null, this._html);
      const teamMenu = L.DomUtil.create("select", null, addArea);
      for (const t of this._me.Teams) {
        if (t.State != "On") continue;
        const o = L.DomUtil.create("option", null, teamMenu);
        o.value = t.ID;
        o.textContent = t.Name;
      }
      const permMenu = L.DomUtil.create("select", null, addArea);
      const read = L.DomUtil.create("option", null, permMenu);
      read.value = "read";
      read.textContent = wX("READ");
      const write = L.DomUtil.create("option", null, permMenu);
      write.value = "write";
      write.textContent = wX("WRITE");
      const ao = L.DomUtil.create("option", null, permMenu);
      ao.value = "assignedonly";
      ao.textContent = wX("ASSIGNED_ONLY");
      const ab = L.DomUtil.create("button", null, addArea);
      ab.type = "button";
      ab.name = "Add";
      ab.value = "Add";
      ab.textContent = wX("ADD");

      L.DomEvent.on(ab, "click", (ev) => {
        L.DomEvent.stop(ev);
        this.addPerm(teamMenu.value, permMenu.value); // async, but no need to await
        // addPerm calls wasabeeUIUpdate, which redraws the screen
      });
    }

    const buttons = {};
    buttons[wX("OK")] = () => {
      this._dialog.dialog("close");
    };

    this._dialog = window.dialog({
      title: wX("PERMS", this._operation.name),
      html: this._html,
      height: "auto",
      dialogClass: "wasabee-dialog wasabee-dialog-perms",
      closeCallback: () => {
        this.disable();
        delete this._dialog;
      },
      id: window.plugin.wasabee.static.dialogNames.linkList,
    });
    this._dialog.dialog("option", "buttons", buttons);
  },

  // needs this._operation.teamlist;
  buildTable: function () {
    this._table = new Sortable();
    this._table.fields = [
      {
        name: wX("TEAM"),
        value: (perm) => {
          const t = WasabeeTeam.cacheGet(perm.teamid);
          if (t) return t.name;
          if (this._me) {
            for (const mt of this._me.Teams) {
              if (mt.ID == perm.teamid) return mt.Name + " (off)";
            }
          }
          return "[" + perm.teamid + "]";
        },
        sort: (a, b) => a.localeCompare(b),
        // , format: (cell, value) => (cell.textContent = value)
      },
      {
        name: wX("ROLE"),
        value: (perm) => perm.role,
        sort: (a, b) => a.localeCompare(b),
        // , format: (cell, value) => (cell.textContent = value)
      },
    ];

    if (WasabeeMe.isLoggedIn()) {
      this._table.fields.push({
        name: wX("REMOVE"),
        value: () => wX("REMOVE"),
        sort: (a, b) => a.localeCompare(b),
        format: (cell, value, obj) => {
          const link = L.DomUtil.create("a", null, cell);
          link.href = "#";
          link.textContent = value;
          L.DomEvent.on(link, "click", (ev) => {
            L.DomEvent.stop(ev);
            this.delPerm(obj); // calls wasabeeUIUpdate -- async but no need to await
          });
        },
      });
    }
    this._table.sortBy = 0;
    this._table.items = this._operation.teamlist;
  },

  addPerm: async function (teamID, role) {
    if (!WasabeeMe.isLoggedIn()) {
      alert(wX("NOT LOGGED IN SHORT"));
      return;
    }
    for (const p of this._operation.teamlist) {
      if (p.teamid == teamID && p.role == role) {
        console.log("not adding duplicate");
        window.runHooks("wasabeeUIUpdate", this._operation);
        return;
      }
    }
    try {
      await addPermPromise(this._operation.ID, teamID, role);
      // add locally for display
      this._operation.teamlist.push({ teamid: teamID, role: role });
      this._operation.store();
      window.runHooks("wasabeeUIUpdate", getSelectedOperation());
    } catch (e) {
      console.log(e);
      alert(e);
    }
  },

  delPerm: async function (obj) {
    if (!WasabeeMe.isLoggedIn()) {
      alert(wX("NOT LOGGED IN SHORT"));
      return;
    }
    try {
      await delPermPromise(this._operation.ID, obj.teamid, obj.role);
      const n = new Array();
      for (const p of this._operation.teamlist) {
        if (p.teamid != obj.teamid || p.role != obj.role) n.push(p);
      }
      this._operation.teamlist = n;
      this._operation.store();
      window.runHooks("wasabeeUIUpdate", getSelectedOperation());
    } catch (e) {
      console.log(e);
      alert(e);
    }
  },
});

export default OpPermList;
