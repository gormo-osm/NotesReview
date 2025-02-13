'use strict';

/* globals L */

/* globals UI */
/* globals Localizer */
/* globals Permalink */
/* globals Mode */

//Search for all notes with a specific keyword either worldwide or if the bounding box is smaller than 0.25 square degree, in that bbox
function search(query, limit, closed, user, from, to) {

  let useNormalApi = false;
  let url = Request.buildURL(query, limit, closed, user, from, to, false);

  const size = Maps.getBBoxSize();

  if (size <= 4) {
    useNormalApi = true;
    url = [];

    if (size < 0.25) {
      // Search only in one bounding box
      url = Request.buildURL(Maps.getBBox(), limit, closed, user, from, to, true);
    } else if (size >= 0.25 && size <= 1) {
      // Split the bounding box into four parts and make the requests after each other
      const split = Maps.splitBBox(Maps.getBounds());
      for (let i = 0; i < split.length; i++) {
        url.push(Request.buildURL(split[i].toBBoxString(), limit, closed, user, from, to, true));
      }
    } else if (size >= 1 && size <= 4) {
      // Split the bounding box into sixteen parts and make the requests after each other
      let split = [];
      const firstSplit = Maps.splitBBox(Maps.getBounds());
      for (let i = 0; i < firstSplit.length; i++) {
        split = split.concat(Maps.splitBBox(firstSplit[i]));
      }
      for (let i = 0; i < split.length; i++) {
        url.push(Request.buildURL(split[i].toBBoxString(), limit, closed, user, from, to, true));
      }
    }
  }

  Request.getAsGeoJSON(url, function(result) {
    if (result.features.length === 0) {
      return UI.nothingFound();
    }

    let ids = [];

    // Prepare the GeoJSON layer and bind the popups
    const geoJSONLayer = L.geoJSON(result, {
      filter: function(feature) {
        return filterGeoJSON(feature.properties, useNormalApi, ids, query, user, from, to);
      },
      onEachFeature: function(feature, layer) {
        const note = feature.properties;
        if (note) {
          ids.push(note.id);
          const comment = note.comments[0];
          const age = UI.getAgeOfNote(note.date_created);
          const user = comment.user || Localizer.getMessage('note.anonymous');

          layer.bindPopup(
            '<div class="card white z-depth-0">' +
              '<div class="card-content black-text no-padding">' +
                '<span class="card-title">' +
                  note.id + ' (' + user + ')' +
                  age.badge +
                  UI.getAmountOfCommentsBadge(note.comments) +
                '</span>' +
                '<p>' + comment.html + '</p>' +
              '</div>' +
              '<div class="card-action no-padding">' +
                UI.getNoteActions(comment.html, note.id, feature.geometry.coordinates) +
              '</div>' +
            '</div>'
          );

          if (closed === '-1') {
            let iconUrl;
            if (note.status === 'open') {
              iconUrl = 'assets/open.svg';
            } else if (note.status === 'closed') {
              iconUrl = 'assets/closed.svg';
            }
            layer.setIcon(new L.Icon({
              iconUrl: iconUrl,
              iconSize: [40, 40],
              iconAnchor: [20, 45],
              popupAnchor: [0, -30]
            }));
          } else {
            layer.setIcon(new L.Icon({
              iconUrl: 'assets/markers/' + age.icon,
              shadowUrl: 'assets/markers/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
            }));
          }
        }
      }
    });

    if (geoJSONLayer.getLayers().length === 0) {
      return UI.nothingFound();
    }

    //Display how much notes were found
    document.getElementById('found-notes').textContent = Localizer.getMessage('note.found') + ids.length;

    Maps.removeLayers();

    const markers = L.markerClusterGroup();
    markers.addLayer(geoJSONLayer);

    //Display all notes on the map and zoom the map to show them all
    const map = Maps.get();
    map.addLayer(markers);
    map.flyToBounds(markers.getBounds(), {
      duration: 1
    });

    UI.toggleButtons();
  });
}

function filterGeoJSON(note, useNormalApi, ids, query, user, from, to) {
  if (useNormalApi) {
    from = from === '' ? new Date(0) : new Date(from);
    to = to === '' ? new Date() : new Date(to);
    const created = new Date(note.date_created.replace(/-/g, '/'));

    return (ids.indexOf(note.id) === -1) && // Check whether the note is not yet in the array
           (note.comments[0].text.toLocaleUpperCase().includes(query.toLocaleUpperCase())) && // Check whether the query is included in the comment
           (created > from && created < to) && // Check whether the note was created during the correct range
           (user !== '' ? user.localeCompare(note.comments[0].user || Localizer.getMessage('note.anonymous')) === 0 : true); // Check whether the specified user also created the note
  }
  return ids.indexOf(note.id) === -1;
}

const Maps = (function() {
  const me = {};

  let map;

  me.get = function() {
    return map;
  };

  me.search = search;

  me.tiles = function() {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22,
      attribution: Localizer.getMessage('map.attribution')
    }).addTo(map);
  };

  me.removeLayers = function() {
    map.eachLayer(function(layer) {
      map.removeLayer(layer);
    });
    Maps.tiles();
  };

  me.BBoxToSquareDegree = function(bounds) {
    // (maxlat - minlat) * (maxlon - minlon) < 0.25
    return (bounds.getNorth() - bounds.getSouth()) * (bounds.getEast() - bounds.getWest());
  };

  me.getBBox = function() {
    return map.getBounds().toBBoxString();
  };

  me.getBounds = function() {
    return map.getBounds();
  };

  me.getBBoxSize = function() {
    const bounds = map.getBounds();
    return Maps.BBoxToSquareDegree(bounds);
  };

  me.splitBBox = function(bbox) {
    const boxes = [];

    let lon = (bbox.getWest() + bbox.getEast()) / 2;
    let lat = (bbox.getSouth() + bbox.getNorth()) / 2;
    if(lon -180 > 0) {
      lon -= 360;
    } else if (lon + 180 < 0) {
      lon += 360;
    }

    boxes.push(L.latLngBounds(L.latLng(bbox.getSouth(), bbox.getWest()), L.latLng(lat, lon)));
    boxes.push(L.latLngBounds(L.latLng(bbox.getSouth(), lon), L.latLng(lat, bbox.getEast())));
    boxes.push(L.latLngBounds(L.latLng(lat, lon), L.latLng(bbox.getNorth(), bbox.getEast())));
    boxes.push(L.latLngBounds(L.latLng(lat, bbox.getWest()), L.latLng(bbox.getNorth(), lon)));

    return boxes;
  };

  me.init = function() {
    map = L.map('map', {
      minZoom: 2,
      maxZoom: 22
    }).setView([40, 10], 3);

    map.on('move', function() {
      Permalink.update();
      UI.tooltip();
    });

    L.Control.geocoder({
      collapsed: false,
      placeholder: Localizer.getMessage('action.search'),
      errorMessage: Localizer.getMessage('description.nothingFound')
    }).addTo(map);

    Maps.tiles();
  };

  return me;
})();

// init modules
Mode.set(Mode.MAPS);
Localizer.init(function() {
  Maps.init();
  Permalink.update();
  UI.init();
});
