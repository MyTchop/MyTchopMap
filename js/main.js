(function () {
  'use strict';
  // LAS VEGAS FOOD TRUCKS MAP - main application Javascript

  /*************************************************************************
  //
  // APPLICATION INITIALIZING
  // You should not have to edit these global variables here
  //
  // ***********************************************************************/

  // Current date and time, from moment.js
  var NOW   = moment(),
      TODAY = moment().startOf('day')

  // Map variables
  var MAP_CENTER_OFFSET   = _getCenterOffset(),
      MAPBOX_ID_OVERRIDE  = _getQueryStringParams('map')

  // Set a timeout to log to Google Analytics if application takes too long to load.
  var LOAD_TIMEOUT_LENGTH_01 = 3000
  var LOAD_TIMEOUT_LENGTH_02 = 5000
  var LOAD_TIMEOUT_LENGTH_03 = 10000
  var LOAD_TIMEOUT_01 = setTimeout(function () {
                          _loadTimeout(LOAD_TIMEOUT_LENGTH_01)
                        }, LOAD_TIMEOUT_LENGTH_01)
  var LOAD_TIMEOUT_02 = setTimeout(function () {
                          _loadTimeout(LOAD_TIMEOUT_LENGTH_02)
                        }, LOAD_TIMEOUT_LENGTH_02)
  var LOAD_TIMEOUT_03 = setTimeout(function () {
                          _loadTimeout(LOAD_TIMEOUT_LENGTH_03)
                        }, LOAD_TIMEOUT_LENGTH_03)

  // Set a timeout to display a loading screen if API data takes too long to load.
  var SPINNER_TIMEOUT_LENGTH = 2000
  var SPINNER_TIMEOUT = setTimeout(function () {
                          _loadSpinner(SPINNER_TIMEOUT_LENGTH)
                        }, SPINNER_TIMEOUT_LENGTH)

  // Debug options
  var DEBUG_ALLOW = true
  var DEBUG_MODE = false
  var DEBUG_CONCIERGE_MODE,
      DEBUG_FAKE_METERS
  var DEBUG_CLV_VENDOR_IMAGE = 1

  if (_getQueryStringParams('debug') == 1) {
    _debug()
  }


  /*************************************************************************
  //
  // POLYFILLS
  // Usually for IE8 unless otherwise specified
  //
  // ***********************************************************************/

  if (!Array.isArray) {
    Array.isArray = function (vArg) {
      return Object.prototype.toString.call(vArg) === '[object Array]'
    }
  }

  /*************************************************************************
  //
  // TRUCKS MAP LOGIC
  // An object that has all the logic for creating the trucks map
  //
  // ***********************************************************************/

  var trucks = {

    // Placeholder for data retrieved from back-end API
    data: {
      'locations': null,
      'timeslots': null,
      'vendors':   null
    },

    // Placeholder for schedule object for the front end
    schedule: {
      'now': {
        'entries': []
      },
      'later': {
        'entries': []
      },
      'tomorrow': {
        'entries': []
      }
    },

    _transformLocationsResponse: function (response) {

      var locations = response

      // Data munging
      for (var j = 0; j < locations.features.length; j ++) {
        // Strip city name/state/zip from address
        // assuming that the address format was entered properly, anyway....
        locations.features[j].properties.addressShort = locations.features[j].properties.address.split(',')[0]

        // Inject marker styles for mapbox.js
        // Disabled due to small icons... not good for retina
        locations.features[j].properties['marker-symbol'] = 'restaurant'
        locations.features[j].properties['marker-color'] = '#f93'
        locations.features[j].properties['marker-size'] = 'large'

        if (DEBUG_FAKE_METERS == 1) {
          locations.features[j].properties.current_vendor_id = ''
        }

      }

      // Inject dummy current vendor data
      if (DEBUG_FAKE_METERS == 1) {
        locations.features[1].properties.current_vendor_id = [4, 18, 26]
        locations.features[2].properties.current_vendor_id = 6
      }

      return locations
    },

    _transformVendorsResponse: function (response) {

      var vendors = response

      // Sort vendors by name
      vendors = vendors.sort(_sort_by('name', true, function(a){return a.toUpperCase()}))

      // Clean up website URLs if present
      for (var i = 0; i < vendors.length; i ++) {
        if (vendors[i].website) {
          vendors[i].website = _addHttp(vendors[i].website)
        }
      }

      // Inject MVP vendor images
      if (DEBUG_CLV_VENDOR_IMAGE === 1) {

        var imagePath = 'img/vendor-cache/'
        var imageIDs = [4, 6, 10, 11, 12, 13, 14, 17, 19, 20, 21, 22, 23, 24, 26, 30, 32, 34, 35, 36, 39]

        for (var i = 0; i < imageIDs.length; i++) {
          for (var j = 0; j < vendors.length; j++) {
            if (vendors[j].id == imageIDs[i]) {
              if (!vendors[j].logo_url) {
                vendors[j].logo_url = imagePath + imageIDs[i] + '.jpg'
              }
            }
          }
        }
      }

      return vendors
    },

    _transformTimeslotsResponse: function (response) {

      var timeslots = response

      // Sort timeslots by time
      timeslots = timeslots.sort(_sort_by('start_at', true))

      // Actions
      for (var i = 0; i < timeslots.length; i++) {
        var start = moment(timeslots[i].start_at)
        var end = moment(timeslots[i].finish_at)

        // Add some helpful information for start times
        timeslots[i].day_of_week = start.format('ddd')
        timeslots[i].month = start.format('MMMM')
        timeslots[i].day = start.date()
        timeslots[i].year = start.year()

        // Formatted strings
        timeslots[i].from = _formatTime(start)
        timeslots[i].until = _formatTime(end)
      }

      return timeslots
    },



  }


  /*************************************************************************
  //
  // RETRIEVE DATA FROM BACK-END API
  // Done asynchronously
  //
  // ***********************************************************************/

  $.when(
    $.ajax({
      url: API_SERVER + API_LOCATIONS,
      cache: false,
      dataType: 'json',
      success: function (response) {
        trucks.data.locations = trucks._transformLocationsResponse(response)
      },
      error: function (jqhxr) {
        showError('We couldn\'t retrieve vendor locations at this time.')
      }
    }),
      $.ajax({
      url: API_SERVER + API_VENDORS,
      cache: false,
      dataType: 'json',
      success: function (response) {
        trucks.data.vendors = trucks._transformVendorsResponse(response)
       },
      error: function (jqhxr) {
        showError('We couldn\'t retrieve vendor information at this time.')
      }
    }),
    $.ajax({
      url: API_SERVER + API_TIMESLOTS,
      cache: false,
      dataType: 'json',
      success: function (response) {
        trucks.data.timeslots = trucks._transformTimeslotsResponse(response)
      },
      error: function (jqhxr) {
        showError('We couldn\'t retrieve vendor schedule at this time.')
      }
    })
  ).then( function () {
    // Actions to perform after all APIs have responded

    var timeslots = trucks.data.timeslots,
        vendors   = trucks.data.vendors,
        locations = trucks.data.locations

    // Add vendors to timeslot data because the new API doesn't do it
    for (var i = 0; i < timeslots.length; i++ ) {
      for (var j = 0; j < vendors.length; j ++) {
        if (timeslots[i].vendor_id === vendors[j].id) {
          timeslots[i].vendor = vendors[j]
        }
      }
    }

    // Debug mode data injection
    if (DEBUG_CONCIERGE_MODE === 1) {

      // for each location, find out if a vendor is "supposed" to be there
      for (var b = 0; b < locations.features.length; b++) {
        for (var c = 0; c < timeslots.length; c++) {

          var start = moment(timeslots[c].start_at)
          var end = moment(timeslots[c].finish_at)

          if (timeslots[c].location_id == locations.features[b].id && start < NOW && end > NOW) {
            locations.features[b].properties.current_vendor_id = timeslots[c].vendor_id
          }
        }
      }
    }

    // Hide loading screen
    $('#loading').hide()

    // Populate the map & app with this stuff
    putInData(locations, timeslots, vendors)
    doMapStuff(locations, timeslots, vendors)

    // Complete the loading process
    $('#vendor-head-now').click()

    // Clean up
    clearTimeout(LOAD_TIMEOUT_01)
    clearTimeout(LOAD_TIMEOUT_02)
    clearTimeout(LOAD_TIMEOUT_03)
    clearTimeout(SPINNER_TIMEOUT)

  }, function () {
    // On failure
    ga('send', 'event', 'load', 'error', 'Failure on jQuery.when for the three API sources')
  })

  /*************************************************************************
  //
  // MAPBOX.JS HACKS
  // Extend map with a variant of map.panTo() method to accept center offset
  //
  // ***********************************************************************/

  L.Map.prototype.panToOffset = function (latlng, offset, options) {
    var x = this.latLngToContainerPoint(latlng).x - offset[0]
    var y = this.latLngToContainerPoint(latlng).y - offset[1]
    var point = this.containerPointToLatLng([x, y])
    return this.setView(point, this._zoom, { pan: options })
  }


  /*************************************************************************
  //
  // INITIALIZE MAP
  // Sets initial location, view, attribution, marker types
  //
  // ***********************************************************************/

  var map = L.mapbox.map('map')
    .setView(MAP_INIT_LATLNG, MAP_INIT_ZOOM)
    // This will be overridden later when map bounds are set based on available markers.

  if (MAPBOX_ID_OVERRIDE) {
    // If a custom map style is required for testing
    map.addLayer(L.mapbox.tileLayer(MAPBOX_ID_OVERRIDE))
  }
  else {
    // Use normal map
    map.addLayer(L.mapbox.tileLayer(MAPBOX_ID, {
      detectRetina: true,
      retinaVersion: MAPBOX_ID_RETINA
    }))
  }

  // Set up icons for markers
  var markerIconSize    = [36, 62], // size of the icon
      markerIconAnchor  = [18, 50], // point of the icon which will correspond to marker's location
      markerPopupAnchor = [0, -55]  // point from which the popup should open relative to the iconAnchor

  var vendorMarker = L.icon({
    iconUrl: 'img/pin-food-on.png',

    iconSize:     markerIconSize,
    iconAnchor:   markerIconAnchor,
    popupAnchor:  markerPopupAnchor
  })

  var vendorMarkerOff = L.icon({
    iconUrl: 'img/pin-food-off.png',

    iconSize:     markerIconSize,
    iconAnchor:   markerIconAnchor,
    popupAnchor:  markerPopupAnchor
  })

  // Not used - currently using Mapbox version of this icon.
  var hereMarker = L.icon({
    iconUrl: 'img/pin-here.png',

    iconSize:     markerIconSize,
    iconAnchor:   markerIconAnchor,
    popupAnchor:  markerPopupAnchor
  });


  /*************************************************************************
  //
  // UI
  // Makes liberal use of jQuery to do things
  //
  // ***********************************************************************/

  $(document).ready( function () {

    // INTERNET EXPLORER
    // Bind a click to close unsupported IE browser warning message
    $('.dismiss-ie-browser').click( function (e) {
      e.preventDefault()
      $('.ie-browser').hide()
    })

    // TRUCK HEADING - toggler for entries
    $('.vendor-heading').click( function () {
      toggleVendorEntries($(this))
    })

    // FOOTER POPUPS
    // Open / toggle
    $('.footer-vendors-link').click( function () {
      toggleFooterPopup('#vendors', $(this))
      ga('send', 'event', 'click', 'footer-vendors')
    })
    $('.footer-calendar-link').click( function () {
      toggleFooterPopup('#calendar', $(this))
      ga('send', 'event', 'click', 'footer-calendar')
    })
    $('.footer-about-link').click( function () {
      toggleFooterPopup('#about', $(this) )
      ga('send', 'event', 'click', 'footer-about')
    })
    $('.footer-feedback-link').click( function () {
      toggleFooterPopup('#feedback', $(this))
      ga('send', 'event', 'click', 'footer-feedback')
      _resetFeedbackForm()
    })
    // Close popups
    // -- when X is clicked on inside the popup
    $('.footer-popup-close').click( function () {
      $('.footer-popup').slideUp(200)
    })
    // -- when user clicks outside the popup
    $('#map').on('click', function () {
      $('.footer-popup').slideUp(200)
    })

    // Sneaky disabling of attribution link on small windows
    $('.leaflet-control-attribution a').on('click', function() {
      if (window.screen.width < 530) {
        return false
      }
    })

    // Make tapping truck info popups on mobile easier
    if (window.screen.width < 767) {
      $('.leaflet-popup-pane').on('click', '.popup-vendor', function () {
        if ($(this).find('a').attr('href').length > 0) {
          window.open($(this).find('a').attr('href'), '_blank')
        }
        // Note that $(this).find() is necessary in case the popup has more than one vendor on it,
        // which can happen if it includes both current and scheduled vendors.
      })
      $('.leaflet-popup-pane').on('click', '.popup-location', function () {
        window.open($('.popup-location a').attr('href'), '_blank')
      })
      $('.leaflet-popup-pane').on('click', 'a', function (e) {
        e.preventDefault()
      })
    }

    // Feedback form shtuff
    $('#feedback-type').on('change', function () {
      _checkFeedbackForm()
    })
    $('#feedback-content').on('keyup', function () {
      _checkFeedbackForm()
    })
    $('#feedback-submit').on('click', function (e) {
      // e.preventDefault()
      _sendFeedback()
    })

    // Other event listening
    $('#pi').on('click', function () {
      ga('send', 'event', 'click', 'pi')
    })
    $('#vendor-head-later').on('click', function () {
      ga('send', 'event', 'click', 'vendor-later')
    })
    $('#vendor-head-muchlater').on('click', function () {
      ga('send', 'event', 'click', 'vendor-muchlater')
    })

    // Recalc map-related things if window gets resized.
    $(window).on('resize', function (e) {
      map.invalidateSize()
    })

    // Keybinding for debug menu & toggle
    $(document).keydown(function (e) {
      if (e.which === 68 && e.ctrlKey === true && e.metaKey === false) {    // key 'ctrl-d' - opens debug menu
        if ($('#feedback').is(':visible')) {
          return
        }
        e.preventDefault()
        if ($('#debug').is(':visible')) {
          $('#debug').hide()
        } else {
          _debug()
        }
      }
    })


    /*************************************************************************
    // GEOLOCATE!
    // This uses the HTML5 geolocation API, which is available on
    // most mobile browsers and modern browsers, but not in Internet Explorer
    //
    // See this chart of compatibility for details:
    // http://caniuse.com/#feat=geolocation
    // ***********************************************************************/

    if (navigator.geolocation) {
      map.locate()
    }

    // Once we've got a position, add a marker.
    map.on('locationfound', function (e) {

      var pointLatLng = [e.latlng.lat, e.latlng.lng]
      var pointLngLat = [e.latlng.lng, e.latlng.lat]

      map.featureLayer.setGeoJSON({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: pointLngLat
        },
        properties: {
          'marker-size': 'large',
          'marker-color': '#cd0000',
          'marker-symbol': 'star-stroked',
          'title': '<div class=\'popup-message\'>You are here</div>'
        }
      })

    })

  })



  /*************************************************************************
  //
  // FUNCTIONS
  //
  // ***********************************************************************/

  // NOTE EVERYTHING BELOW HERE IS A PRETTY HUGE MESS
  // ***********************************************************************/



  function putInData(locations, timeslots, vendors) {

  // Populate schedule
  // let's just be stupid with this code right now.
  // ***********************************************************************************************
    var $panelNow = $('#vendor-info-now .vendor-entry-list')
    var $panelLater = $('#vendor-info-later .vendor-entry-list')
    var $panelMuchLater = $('#vendor-info-muchlater .vendor-entry-list')

    var mustacheScheduleEntry = $('#mustache-schedule-entry').html()

    var schedule = trucks.schedule

    // Current vendor id is stored in the location object.
    // Use this to create the schedule.now list
    for (var i = 0; i < locations.features.length; i++) {

      var currentVendorId = locations.features[i].properties.current_vendor_id

      // If current_vendor_id is an array of vendors
      if (Array.isArray(currentVendorId)) {
        for (var m = 0; m < currentVendorId.length; m++) {
          for (var j = 0; j < vendors.length; j++) {
            if (vendors[j].id == currentVendorId[m]) {
              var k = schedule.now.entries.push( { vendor: vendors[j] } ) - 1
              schedule.now.entries[k].location_id = locations.features[i].id
              schedule.now.entries[k].location = locations.features[i].properties
            }
          }
        }
      }

      // If single number
      // This duplicates some of the functionality of above
      else if (currentVendorId) {
        for (var j = 0; j < vendors.length; j++) {
          if (vendors[j].id == currentVendorId) {
            var k = schedule.now.entries.push( { vendor: vendors[j] } ) - 1
            schedule.now.entries[k].location_id = locations.features[i].id
            schedule.now.entries[k].location = locations.features[i].properties
          }
        }
      }
    }

    // Use timeslot data to create the rest of the schedule object
    for (var i = 0; i < timeslots.length; i++) {

      var start = moment(timeslots[i].start_at)
      var end = moment(timeslots[i].finish_at)

      var locationId = timeslots[i].location_id

      // add location data to schedule object
      for (var j = 0; j < locations.features.length; j++) {
        if (timeslots[i].location_id == locations.features[j].id) {
          timeslots[i].location = locations.features[j].properties
        }
      }

      // NOW OPEN - Timeslot processing
      if (NOW > start && NOW < end) {
        for (var k = 0; k < schedule.now.entries.length; k++) {
          if (timeslots[i].location_id == schedule.now.entries[k].location_id) {
            schedule.now.entries[k].until = timeslots[i].until
            schedule.now.entries[k].id = timeslots[i].id
          }
        }
      }

      // OPEN LATER - Timeslot processing
      // 20-minute grade period
      if (start.isSame(NOW, 'day') && start.clone().add('minutes', 21).isAfter(NOW)) {

        // need to make sure that this timeslot entry is not already on the "now" list.
        for (var q = 0; q < schedule.now.entries.length; q++) {
          if (timeslots[i].id === schedule.now.entries[q].id) {
            timeslots[i].current = true
          }
        }

        if (timeslots[i].current != true) {
          schedule.later.entries.push(timeslots[i])
        }

      }

      // time slots starting tomorrow
      var compareday = moment(NOW).add('days', 1)
      if (start.isSame(compareday, 'day')) {
        timeslots[i].tomorrow = true

        schedule.tomorrow.entries.push(timeslots[i])
      }
    }

    if (schedule.now.entries.length > 0) {
      $panelNow.html(Mustache.render(mustacheScheduleEntry, schedule.now))
    } else{
      $('#vendor-info-now h3').html('There are no trucks open right now.')
    }
    if (schedule.later.entries.length > 0) {
      $panelLater.html(Mustache.render(mustacheScheduleEntry, schedule.later))
    } else {
      $('#vendor-info-later h3').html('There are no trucks open later.')
    }
    if (schedule.tomorrow.entries.length > 0) {
      $panelMuchLater.html(Mustache.render(mustacheScheduleEntry, schedule.tomorrow))
    } else {
      $('#vendor-info-muchlater h3').html('There are no trucks open tomorrow.')
    }

  // ***********************************************************************************************

    // Populate footer elements
    if (vendors.length > 0) {
      var mustacheFooterAllVendors = $('#mustache-footer-all-vendors').html()
      var data = {}
      data.vendors = vendors
      $('#vendors .insert').html(Mustache.render(mustacheFooterAllVendors, data))
    }


    // Make Calendar
    $('#calendar .insert').html(makeCalendar())


  }


  /**
   *  Displays markers on map and binds marker popups
   */

  function doMapStuff (locations, timeslots, vendors) {

    var schedule = trucks.schedule

    // Populate map with locations
    var markers = L.mapbox.featureLayer(locations, {
      filter: function (feature) {
        return true
        // disabled active filter
        // return feature.properties.active === true
      }
    }).eachLayer(function (marker) {

      // Set options for marker (directly on the marker object itself)
      marker.options.icon = vendorMarkerOff  // Off by default
      marker.options.riseOnHover = true

      // Obtain truck information if there is a current vendor present, according to Locations API
      // Note that marker.feature is a synonym for data.locations.features[x] - location
      // data is now attached to the marker itself.
      if (marker.feature.properties.current_vendor_id) {

        var currentVendorId = marker.feature.properties.current_vendor_id

        if (!marker.vendor) {
          marker.vendor = []
        }

        // Add vendor information for current vendor
        if (Array.isArray(currentVendorId)) {
          for (var m = 0; m < currentVendorId.length; m++) {
            for (var j = 0; j < vendors.length; j++) {
              if (vendors[j].id === currentVendorId[m]) {
                marker.vendor.push(vendors[j])
              }
            }
          }
        }
        else if (currentVendorId) {
          for (var j = 0; j < vendors.length; j++) {
            if (vendors[j].id === currentVendorId) {
              marker.vendor.push(vendors[j])
              break
            }
          }
        }

        // Add time slot end for current location and time
        // Important: do NOT base on vendor, because that may change.
        // If there is NO time slot, leave this empty, since we don't have reports from
        // the parking meter back-end about how long someone is paid through till.
        for (var k = 0; k < timeslots.length; k++) {

          var start = moment(timeslots[k].start_at)
          var end = moment(timeslots[k].finish_at)

          if (marker.feature.id == timeslots[k].location_id && NOW.isAfter(start) && NOW.isBefore(end)) {
            marker.schedule = {}
            var until = moment(timeslots[k].finish_at)
            marker.schedule.until = _formatTime(until)
          }
        }

      }

      // By now, the schedule object should be populated. Attach data to
      // markers based on schedule object.

      // (at some point, code above should also just draw from schedule object?)

      // Add the next vendor ('ondeck') if there is one starting later today.
      var later = schedule.later.entries

      for (var m = 0; m < later.length; m++) {

        var start = moment(later[m].start_at)

        if (marker.feature.id == later[m].location_id) {
          marker.ondeck = later[m]
          break
        }

      }

      // Construct popup through Mustache template
      var mPopleaf = $('#mustache-popleaf').html()
      var popupHTML = Mustache.render(mPopleaf, marker)

      if (marker.vendor) {
        // Turn on marker if the vendor is there
        marker.options.icon = vendorMarker
      }

      marker.bindPopup(popupHTML, {
        closeButton: false,
        minWidth: 200,
        autoPanPadding: [30, 20]
      })

    }).addTo(map)

    // Set the bounding area for the map
    map.fitBounds(markers.getBounds().pad(MAP_FIT_PADDING), {
      paddingTopLeft: MAP_CENTER_OFFSET
    })
    map.setMaxBounds(markers.getBounds().pad(MAP_MAX_PADDING))

    // Center marker on click
    markers.on('click', function (e) {
      map.panToOffset(e.layer.getLatLng(), _getCenterOffset())
    })

    // TRUCK ENTRY - Activate marker on click
    $('#vendor-info').on('click', '.vendor-entry', function () {
      var locationId = $(this).data('locationId')
      markers.eachLayer( function (marker) {
        if (marker.feature.id === locationId) {

          map.panToOffset(marker.getLatLng(), _getCenterOffset())

          marker.openPopup()
        }
      })
    })

  }

  /**
   *   Shows or hides trucks under each section of trucks data panel
   */

  function toggleVendorEntries(clickedHeading) {

    // if clicked heading is currently open, just close it
    if (clickedHeading.next('.vendor-entries').is(':visible')) {
      clickedHeading.removeClass('active')
      $('.vendor-entries').slideUp(200)
    }

    // otherwise, close other open headings (if any) and open the one that's clicked
    else {
      if ($('.vendor-entries').is(':visible')) {
        $('.vendor-entries').prev('.vendor-heading').removeClass('active')
        $('.vendor-entries').slideUp(200)
      }
      clickedHeading.next('.vendor-entries').slideDown(200)
      clickedHeading.addClass('active')
    }

  }

  /**
   *   Shows or hides a footer element
   */

  function toggleFooterPopup(popup, clicked) {

    if ($(popup).is(':visible')) {
      // If visible, hide it!
      $(popup).slideUp(200)
      // window.location.hash = ''
    }
    else {
      // Hide all other popups
      $('.footer-popup').slideUp(200)

      // Establish popup position in the window
      var position = clicked.offset().left
      if ($(window).width() > 525) {
        if ( $(popup).width() + position <= $(window).width() ) {
          $(popup).css('left', position)
        }
        else {
          $(popup).css('left', $(window).width() - $(popup).width() - 20)
        }
      }
      else {
        $(popup).css('left', 0)
      }

      // Display the popup
      $(popup).slideDown(200)
      // Hash related hijinks are disabled
      // window.location.hash = popup
    }
  }


  /**
   *   Display vendor schedule on footer / calendar popup
   */

  function makeCalendar () {

    // Assuming all entries in the "timeslots" object is today or later,
    // and that timeslots are already sorted in time order, because
    // because the data retrieval process should have already done this.

    var theHTML = ''
    var mustacheCalendarDate = $('#mustache-calendar-date').html()
    var mustacheCalendarList = $('#mustache-calendar-list').html()
    var timeslots = trucks.data.timeslots

    for (var i = 0; i < timeslots.length; i++) {

      var start_day = timeslots[i].day,
        previous_day = 0

      if (i > 0) {
        previous_day = timeslots[i-1].day
      }

      // Display date header, if it needs to change
      if (start_day != previous_day) {

        var date = {
          day_of_week: timeslots[i].day_of_week,
          month:       timeslots[i].month,
          day:         timeslots[i].day,
          year:        timeslots[i].year
        }

        if (i > 0) {
          theHTML = theHTML + '</ul>'
        }

        theHTML = theHTML + Mustache.render(mustacheCalendarDate, date)

        theHTML = theHTML + '<ul>'

      }

      // Display scheduled entry
      var item = {
        name:     timeslots[i].vendor.name,
        website:  timeslots[i].vendor.website,
        location: timeslots[i].location.name,
        logo_url: timeslots[i].vendor.logo_url,
        from:     timeslots[i].from,
        until:    timeslots[i].until
      }

      theHTML = theHTML + Mustache.render(mustacheCalendarList, item)

    }

    if (timeslots.length > 0) {
      theHTML = theHTML + '</ul>'
    }
    else {
      theHTML = 'No upcoming scheduled vendors.'
    }

    return theHTML
  }


  /**
   *   Format time for display
   */

  function _formatTime (date) {

    // date is a moment.js object
    // moment.js can't create string formats where the minutes
    // are optional, so this function returns a string in a format
    // like '6am' or '6:30pm'

    if (date.minutes() > 0) {
      return date.format('h:mma')
    } else {
      return date.format('ha')
    }
  }


  /*************************************************************************
  //
  // UTILITY FUNCTIONS
  //
  // ***********************************************************************/


  function _sort_by (field, reverse, primer) {
    var key = function (x) {return primer ? primer(x[field]) : x[field]};

    return function (a,b) {
      var A = key(a), B = key(b);
      return ((A < B) ? -1 : (A > B) ? +1 : 0) * [-1,1][+!!reverse];
    }
  }

  // Look at website string and add http:// if necessary
  function _addHttp (url) {
    if (!url.match(/^(?:f|ht)tps?:\/\//)) {
      url = 'http://' + url
    }
    return url
  }


  /**
   *   Get center offset of map
   */

  function _getCenterOffset () {

    var offset = [0, 0]

    var $overlay = $('#vendor-data')

    if ($overlay.is(':visible')) {
      var viewableWidth = $(window).width() - $overlay.width() - $overlay.offset().left
      offset[0] =  ($overlay.width() + $overlay.offset().left) / 2
      if (viewableWidth > 840) {
        // Tweak to balance super wide windows.
        offset[0] = offset[0] - 60
      }
    }
    if ($(window).width() < 530) {
      offset[1] = $(window).height() / 4
    } else {
      offset[1] = $(window).height() / 10
    }

    return offset

   }


  /**
   *   Feedback form content validation
   */

  function _checkFeedbackForm () {

    var type = ($('#feedback-type').val() != null) ? true : false
    var content = ($.trim($('#feedback-content').val()) != '') ? true : false

    if ( type == true && content == true ) {
      $('#feedback-submit').prop('disabled', false)
    }
    else {
      $('#feedback-submit').prop('disabled', true)
    }

  }

  function _sendFeedback () {

    $('#feedback-sending').show()

    var feedbackData = {
      feedback: {
        category: $('#feedback-type').val(),
        body: $('#feedback-content').val(),
        email: $('#feedback-email').val()
      }
    }

    $.ajax({
      type: "POST",
      url: API_SERVER + API_FEEDBACK,
      data: feedbackData,
      success: function (i) {
        $('#feedback-sending').hide()
        $('#feedback-success').show()
      },
      error: function (x) {
        $('#feedback-sending').hide()
        $('#feedback-error').show()
      }
    })

  }

  function _resetFeedbackForm () {
    document.getElementById('feedback-form').reset()

    // Call placeholder for IE8
    if ($.prototype.placeholder) {
      $('input, textarea').placeholder()
    }

    // Reset DOM
    $('#feedback-sending').hide()
    $('#feedback-success').hide()
    $('#feedback-error').hide()
  }

  /**
   *   Log to Google Anaytics if it takes too long to load. Call from setTimeout()
   */

  function _loadTimeout (seconds) {
    if (seconds > 999) {
      seconds = seconds / 1000
    }
    var message = 'The application took longer than ' + seconds + ' seconds to load.'
  //  console.log(message)
    ga('send', 'event', 'load', 'timeout', message)
  }

  /**
   *   Show spinning wheel if API takes too long to load. Call from setTimeout()
   */

  function _loadSpinner (milliseconds) {
    $('#loading').fadeIn(200)
  }

  /**
   *   In case of application error, display error modal on page with message.
   */

  function showError (message) {

    $('#vendor-data').hide(250)
    $('#error').show(250)
    $('#error .message').html(message)

    // Clear loading timeouts
    clearTimeout(LOAD_TIMEOUT_01)
    clearTimeout(LOAD_TIMEOUT_02)
    clearTimeout(LOAD_TIMEOUT_03)

    // Send an event to GA
    ga('send', 'event', 'load', 'error', message)

  }


  /**
  *    Get query string for various options
  */

  function _getQueryStringParams(sParam) {
    var sPageURL = window.location.search.substring(1);
    var sURLVariables = sPageURL.split('&');
    for (var i = 0; i < sURLVariables.length; i++) {
      var sParameterName = sURLVariables[i].split('=');
      if (sParameterName[0] == sParam) {
        return sParameterName[1];
      }
    }
  }


  /**
  *    Debug mode activation
  */

  function _debug () {

    if (DEBUG_ALLOW != true) {
      return
    }

    // Activate debug mode
    DEBUG_MODE = true
    $('#debug').show()

    // Get parameters from query string
    DEBUG_FAKE_METERS         = parseInt(_getQueryStringParams('t'))
    DEBUG_CONCIERGE_MODE      = parseInt(_getQueryStringParams('c'))
    var DEBUG_DATE_OVERRIDE   = parseInt(_getQueryStringParams('d')),
        DEBUG_DATE_MONTH      = parseInt(_getQueryStringParams('mm')),
        DEBUG_DATE_DATE       = parseInt(_getQueryStringParams('dd')),
        DEBUG_DATE_YEAR       = parseInt(_getQueryStringParams('y')),
        DEBUG_DATE_HOUR       = parseInt(_getQueryStringParams('h')),
        DEBUG_DATE_MINUTES    = parseInt(_getQueryStringParams('m'))

    // Override Parkeon API with fictional meter data
    if (DEBUG_FAKE_METERS === 1) {
      $('#debug-fake-meters').val(['1'])
    }

    // Override Parkeon API with fictional meter data
    if (DEBUG_CONCIERGE_MODE === 1) {
      $('#debug-concierge-mode').val(['1'])
    }

    // Override application date with debug selection
    if (DEBUG_DATE_OVERRIDE === 1) {
      $('#debug-change-date').val(['1'])

      var DEBUG_DATE = moment().month(DEBUG_DATE_MONTH)
                 .date(DEBUG_DATE_DATE)
                 .year(DEBUG_DATE_YEAR)
                 .hour(DEBUG_DATE_HOUR)
                 .minute(DEBUG_DATE_MINUTES)
      NOW        = moment(DEBUG_DATE)
      TODAY      = moment(DEBUG_DATE).startOf('day')
    }

    // Display current application date
    $('#debug-date').html(NOW.format('ddd MMM D, YYYY HH:mm:ss ([UTC offset] Z)'))

    // Populate correct time/date dropdowns
    $('#debug-date-month').val(NOW.month())
    $('#debug-date-day').val(NOW.date())
    $('#debug-date-year').val(NOW.year())
    $('#debug-date-hour').val(NOW.hour())
    $('#debug-date-minute').val(Math.floor(NOW.minute() / 5) * 5)

    // Hide or show the debug options
    $('#debug-options-button').on('click', function () {
      $('#debug-options').show()
      $('#debug-options-button').hide()
    })
    $('#debug-options-hide').on('click', function () {
      $('#debug-options').hide()
      $('#debug-options-button').show()
    })

    // Auto check 'change date' option if user changes a select dropdown
    $('#debug-menu select').on('change', function () {
      $('#debug-change-date').val(['1'])
    })

  }

}());
