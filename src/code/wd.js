import WasabeeMe from "./me";
import { dKeylistPromise } from "./server";
import WasabeeAgent from "./agent";
import wX from "./wX";
// import { getPortalDetails } from "./uiCommands";

// setup function
export function initWasabeeD() {
  window.plugin.wasabee.defensiveLayers = new L.LayerGroup();
  window.addLayerGroup(
    "Wasabee-D Keys",
    window.plugin.wasabee.defensiveLayers,
    false
  );

  // hook called in init.js after load
  window.map.on("wasabeeDkeys", drawWasabeeDkeys);

  window.map.on("layeradd", (obj) => {
    if (obj.layer === window.plugin.wasabee.defensiveLayers) {
      window.map.fire("wasabeeDkeys", { reason: "init D" }, false);
    }
  });

  window.map.on("layerremove", (obj) => {
    if (obj.layer === window.plugin.wasabee.defensiveLayers) {
      // clearLayers doesn't actually remove the data, just hides it from the map
      window.plugin.wasabee.defensiveLayers.clearLayers();
    }
  });
}

// This is the primary hook that is called on map refresh
// it clears the UI, updates the cache from the server and redraws the UI
// XXX Triggered BEFORE the IDB store gets setup, so first load fails -- subsequent runs are fine
export async function drawWasabeeDkeys() {
  if (window.isLayerGroupDisplayed("Wasabee-D Keys") === false) return;
  console.debug("running drawWasabeeDkeys");
  window.plugin.wasabee.defensiveLayers.clearLayers();

  if (WasabeeMe.isLoggedIn()) {
    try {
      const data = await dKeylistPromise();
      const list = JSON.parse(data);
      if (!list || !list.DefensiveKeys || list.DefensiveKeys.length == 0)
        return;

      for (const n of list.DefensiveKeys) {
        if (!n.Name) {
          console.log("old format WD key, ignoring", n);
          continue;
        }
        await window.plugin.wasabee.idb.put("defensivekeys", n, [
          n.GID,
          n.PortalID,
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  }
  // even if not logged in, draw from indexdb
  drawMarkers(); // no need to await
}

// draws each distinct portalID once
async function drawMarkers() {
  const dks = await window.plugin.wasabee.idb.getAll("defensivekeys");
  const done = new Map();
  for (const dk of dks) {
    if (done.has(dk.PortalID)) continue;
    done.set(dk.PortalID, true);
    drawMarker(dk);
  }
}

// remove and re-add each marker
function drawMarker(dk) {
  if (
    window.plugin.wasabee.defensiveLayers[dk.PortalID] &&
    window.plugin.wasabee.defensiveLayers[dk.PortalID]._leaflet_id
  )
    window.plugin.wasabee.defensiveLayers.removeLayer(
      window.plugin.wasabee.defensiveLayers[dk.PortalID]
    );

  // should never be triggered now
  if (!dk.Name) {
    console.debug("skipping old format", dk);
    return;
  }

  const marker = L.marker([dk.Lat, dk.Lng], {
    title: dk.Name,
    icon: L.divIcon({
      className: "wasabee-defense-icon",
      shadowUrl: null,
      iconSize: L.point(24, 40),
      iconAnchor: L.point(12, 40),
      popupAnchor: L.point(-1, -48),
    }),
  });
  window.plugin.wasabee.defensiveLayers[dk.PortalID] = marker;
  marker.addTo(window.plugin.wasabee.defensiveLayers);

  window.registerMarkerForOMS(marker);
  marker.bindPopup("loading...", {
    className: "wasabee-popup",
    closeButton: false,
  });
  marker.on(
    "click spiderfiedclick",
    async (ev) => {
      L.DomEvent.stop(ev);
      if (marker.isPopupOpen && marker.isPopupOpen()) return;
      try {
        const content = await getMarkerPopup(dk.PortalID);
        console.log(content);
        marker.setPopupContent(content);
        if (marker._popup._wrapper)
          marker._popup._wrapper.classList.add("wasabee-popup");
        marker.update();
      } catch (e) {
        console.error("getting wd marker popup: ", e);
        marker.setPopupContent(e);
        marker.update();
      }
      marker.openPopup();
    },
    marker
  );
}

// draw the popup, display the individual agents and their counts
async function getMarkerPopup(PortalID) {
  const container = L.DomUtil.create("span", null); // leaflet-draw-tooltip would be cool
  const ul = L.DomUtil.create("ul", null, container);

  const dks = new Array();
  const tx = window.plugin.wasabee.idb.transaction(
    ["defensivekeys"],
    "readonly"
  );
  let cursor = await tx.store.index("PortalID").openCursor(PortalID);
  while (cursor) {
    dks.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;

  // since there is an await in here, it can't be in the while loop above
  for (const dk of dks) {
    const a = await WasabeeAgent.get(dk.GID);
    const li = L.DomUtil.create("li", null, ul);
    if (a) {
      li.appendChild(a.formatDisplay());
    } else {
      const fake = L.DomUtil.create("span", null, li);
      fake.textContent = wX("LOADING");
    }
    const c = L.DomUtil.create("span", null, li);
    c.textContent = `:  ${dk.Count} ${dk.CapID}`;
  }

  return container;
}
