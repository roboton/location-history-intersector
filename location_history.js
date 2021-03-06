var HASH_OUTPUT_FILENAME = "location_hashes.out";
var PLAIN_OUTPUT_FILENAME = "locations_times.tsv";

// For "intersections", when the user intersects their locations with a friend's
var intersectHashes = {};
var intersectHashFilename = "";
var intersectHideDataMode = false;
var currentIntersectPw = "";

var numQueries = 0;
var numKeywords = 0;
var redrawTimeout = 0;

var oTable = null;

// Read the zip file containing TakeOut data
function parseZipFile(zipFile) {
  // read the zip file
  JSZip.loadAsync(zipFile).then(
    function (zip) {
      // get a promise for decoding each file in the zip
      const fileParsePromises = [];

      // note zip does not have a .map function, so we push manually into the array
      var numFiles = 0;
      zip.forEach(function (relativePath, zipEntry) {
        if (zipEntry.name.match(/Location History\/Semantic Location History\/2020/)) {
          // parse the file contents as a string
          fileParsePromises.push(
            zipEntry.async('string').then(function(data) {
              return { name: zipEntry.name,
                       textData: data,
                       zipEntry: zipEntry };}));
          numFiles++;
        }
      });
      // when all files have been parsed run the 
      // the text content of the files.
      Promise.all(fileParsePromises).then(processDecompressedFiles);
    },
    function(error) {
      console.error('An error occurred processing the zip file.', error);
      $("#loadingMessage").html("This does not seem to be a valid .zip file.  Please select the .zip file produced by Google Takeout.");
    }
  );
}

// TODO(robon): use this
function updateLoadingMessageQueries(numQueries, numUniqueQueries, startDate,
                                     endDate) {
  if (numQueries == 0) {
    $("#loadingMessage").html("Could not find any location history data in the zip file.");
  } else {
    $("#loadingMessage").html(
      "Processed " + numQueries.toString() + " locations (" +
      numUniqueQueries.toString() + " unique) made between " +
      startDate.toLocaleDateString() + " and " + endDate.toLocaleDateString() +
      ". Average length: " +
      (Math.round(numKeywords * 1000.0 / numQueries) / 1000.0).toString() +
      " keywords");
  }
}

function extractPlaceVisit(placeVisit) {
  var name = placeVisit.location.name;
  if (name === undefined) {
    if (placeVisit.location.address !== undefined) {
      name = placeVisit.location.address;
    } else {
      name = placeVisit.location.placeId;
    }
  }
  var startDt = null;
  var endDt = null;
  var startDtVal = null;
  var endDtVal = null;
  if (placeVisit.duration !== undefined) {
    startDt = new Date(Math.floor(parseInt(
      placeVisit.duration.startTimestampMs) / 60000) * 60000);
    endDt = new Date(Math.ceil(parseInt(
      placeVisit.duration.endTimestampMs) / 60000) * 60000);
    startDtVal = startDt.valueOf();
    endDtVal = endDt.valueOf();
  }

  var placeConfidence = null;
  if (placeVisit.placeConfidence !== undefined) {
    placeConfidence = placeVisit.placeConfidence;
  }

  var visitConfidence = null;
  if (placeVisit.visitConfidence !== undefined) {
    visitConfidence = placeVisit.visitConfidence;
  }
  return([
    {"raw": name, "display": name},
    {"raw": startDtVal, "display": startDt},
    {"raw": endDtVal, "display": endDt},
    {"raw": visitConfidence, "display": visitConfidence},
    {"raw": placeConfidence, "display": placeConfidence},
    {"raw": placeVisit.location.placeId,
     "display": placeVisit.location.placeId},
]);
}

function extractActivity(activitySegment) {
  var startDt = new Date(Math.floor(parseInt(
    activitySegment.duration.startTimestampMs) / 60000) * 60000);
  var endDt = new Date(Math.ceil(parseInt(
    activitySegment.duration.endTimestampMs) / 60000) * 60000);
    return([
      {"raw": activitySegment.activityType,
        "display": activitySegment.activityType},
      {"raw": startDt.valueOf(), "display": startDt},
      {"raw": endDt.valueOf(), "display": endDt},
      {"raw": null,
        "display": null},
      {"raw": activitySegment.confidence,
        "display": activitySegment.confidence}]);
}

// do whatever processing of the decompressed zip file
function processDecompressedFiles(decompressedFiles) {

  var dataSet = [];
  
  // files
  for (var i = 0; i < decompressedFiles.length; i++) {
    var data = JSON.parse(decompressedFiles[i].textData);
    // timelineObjects
    for (var j = 0; j < data.timelineObjects.length; j++) {
      var tlObj = data.timelineObjects[j];
      // filter for placeVisits
      if (tlObj.placeVisit !== undefined) {
        var row = extractPlaceVisit(tlObj.placeVisit);
        if (row[1]["raw"] !== null && row[5] !== null) {
          dataSet.push(row);
        }
        // TODO(robon): Decide if we should remove parent xor child objects
        if (tlObj.placeVisit.childVisits !== undefined) {
          // childVisits
          for (var k = 0; k < tlObj.placeVisit.childVisits.length; k++) {
            var childVisit  = tlObj.placeVisit.childVisits[k];
            var row = extractPlaceVisit(childVisit);
            if (row[1]["raw"] !== null && row[5] !== null) {
              dataSet.push(row);
            }
          }
        }
      } else if (tlObj.activitySegment !== undefined) {
        // TODO(robon): Consider including activitySegments
        // dataSet.push(extractActivity(tlObj.activitySegment));
      }
    }
  }

  oTable = $('#location_table').DataTable({
    "data": dataSet,
    "paging": true,
    "lengthChange": false,
    "searching": true,
    "iDisplayLength": 50,
    "deferRender": true,
    "oLanguage": { "sSearch": "_INPUT_",
                   "sInfo": "Showing _START_ to _END_ of _TOTAL_ locations",
                   "sInfoFiltered": "filtered from _MAX_ total locations",
                   "sSearchPlaceholder": "Filter by keyword",
                   "sEmptyTable": "No data found",
                   "sZeroRecords": "No matching locations" },
     "columnDefs": [{ "title": "Location", "targets": 0,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Start time", "targets": 1,
                      "render":  {_: "display", display: "display",
                      sort: "display"}},
                    { "title": "End time", "targets": 2,
                      "render":  {_: "display", display: "display",
                      sort: "display"}},
                    { "title": "Visit confidence", "targets": 3,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Location confidence", "targets": 4,
                      "render":  {_: "raw", display: "display", sort: "raw"}},
                    { "title": "Location ID", "targets": 5,
                      //"visible": false, "searchable": false,
                      "render":  {_: "raw", display: "display", sort: "raw"}}],
     "order": [[ 2, "desc" ]],
     "drawCallback": function(settings) {
       // If some post-redraw work is in flight, cancel it
       if (redrawTimeout) {
         clearTimeout(redrawTimeout);
       }
       if (intersectHashFilename) {
         $("#intersectionMessage").html("<b>Restricting to locations that were also found in <i>" + intersectHashFilename + "</i></b>  <button onClick=\"intersectClear();\">Reset and show all</button>");
       }
       // Location count message
       var input = $("#location_table_filter").find("input")[0];
       if (!($(input).val()) && !intersectHashFilename) {
         $("#downloadPlainButton").text("Download all rows to a .tsv file");
       } else {
         // Put the correct count in the download button
         $("#downloadPlainButton").text("Download these " +
           oTable.rows({filter: 'applied'}).count() + " rows to a .tsv file");
       }
     }
  });
  addExtraButtons();

  // Register filter for intersection-with-friend
  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    // Don't show any data if the intersector is typing their password
    if (intersectHideDataMode) return false;
    if (intersectHashFilename !== "") {
      var startDt = new Date(data[1]);
      var endDt = new Date(data[2]);
      var curDt = new Date(data[1]);
      while (curDt <= endDt) {
        var placeTs = data[5] + curDt.valueOf();
        var hash = strToHash(placeTs, currentIntersectPw);
        curDt.setMinutes(curDt.getMinutes() + 1);
        if (intersectHashes[hash]) {
          //console.log("matched: " + placeTs);
          return true;
        }
      }
      return false;
    }
    return true;
  });
}

function addExtraButtons() {
  // Header stuff
  // $(".fg-toolbar:first").append("<span id=\"locationCountMessage\"><span>");

  // Footer buttons (export file and do intersection)
  $(".fg-toolbar:last").append("<br><br><div id=\"downloadPlainDiv\">");
  $(".fg-toolbar:last").append("<button id=\"downloadPlainButton\" onClick=\"downloadPlainFileClick()\" title=\"This button lets you save the data to a file so that you can work with it in a spreadsheet such as Google Sheets or Excel.\">Download all rows to a .tsv file</button> ");
  $(".fg-toolbar:last").append("</div>");

  $(".fg-toolbar:last").append("<div id=\"intersectionDiv\">");
  $(".fg-toolbar:last").append("<button id=\"downloadHashButton\" onClick=\"downloadHashFileClick()\" title=\"To see the locations you have in common with a friend, click this button to download the hashes to a file, and then send the file to your friend.  The friend should then select 'Intersect with a friend\''s hashes' below.\">Download hashes for all locations to a file</button> ");
  $(".fg-toolbar:last").append("<br><input type=\"file\" id=\"intersectFile\" /><button id=\"intersectButton\" onClick=\"intersectClick()\">Intersect with a friend's hashes</button>");
  $(".fg-toolbar:last").append("</div>");

  var intersectHashFileInput = document.querySelector('#intersectFile');
  intersectHashFileInput.addEventListener('change', function(event) {
    var files = event.target.files;
    intersectHashes = {};
    for (var i = 0; i < files.length; i++) {
      parseHashFile(files[i]);
    }
    this.value = null;
  });
}

function promptForPassword(isDownload) {
  if (isDownload) {
    // It's a hash download button click
    $("#hash-password-title").html("Enter a password to protect your hash file: ");
    $("#downloadHashButton").prop("disabled", true);
  } else {
    // It's an intersect button click
    $("#hash-password-title").html("Ask your friend to enter the password for their hash file: ");
    $("#intersectButton").prop("disabled", true);
  }
  $("#hash-password-form").show();
  $("#hash-password").focus();

  // clear submit handler before adding new one
  $("#hash-password-form").find("form").off("submit");
  // set the password submit event handler
  $("#hash-password-form").find("form").on("submit", function(event) {
    // stop actual form submit
    event.preventDefault();
    // hide the form after submit
    $("#hash-password-form").hide();
    // do the correct action following submit
    if (isDownload) {
      alert("It may take up to 30 seconds to compute your hash file before the download proceeds. Hit OK to continue.");
      $("#hash-password-message").html("Computing hashes.");
      downloadHashFile($("#hash-password").val());
    } else {
      $("#hash-password-message").html("Pick your friend's hash file.");
      $("#intersectFile").trigger("click");
      currentIntersectPw = $("#hash-password").val();
    }
    $("#hash-password-message").html("");
  });
}

function intersectClick() {
    // Hide the table so that the friend cannot see the visits
    intersectHideDataMode = true;
    $("#intersectionMessage").html("The data is hidden while the intersection password is being entered.");
    oTable.draw();
    alert("First your friend will type the password for their hash file, and then you will be asked to select it from your computer. Hit OK to continue.");
    promptForPassword(false);
}

function downloadHashFileClick() {
    promptForPassword(true);
}

function strToHash(str, pw) {
    return sha256(str+ pw);
}

function downloadHashFile(pw) {
  $("#downloadHashButton").html("Computing...");
  var text = "";
  oTable.rows().every(function(rowIdx, tableLoop, rowLoop) {
    var data = this.data();
    var startDt = new Date(data[1]["raw"]);
    var endDt = new Date(data[2]["raw"]);
    var curDt = new Date(data[1]["raw"]);
    while (curDt <= endDt) {
      text = text + strToHash(data[5]["raw"] + curDt.valueOf(), pw) + "\n";
      curDt.setMinutes(curDt.getMinutes() + 1);
    }
  });

  var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  var hash_filename = HASH_OUTPUT_FILENAME + "." + Date.now();
  saveAs(blob, hash_filename);
  $("#downloadHashButton").html("Hashes downloaded to \"" + hash_filename+ "\"");
}

function downloadPlainFileClick() {
  $("#downloadPlainButton").html("Computing...");
  $("#downloadPlainButton").prop("disabled", true);
  alert("It may take a few moments to export the file. Hit OK to continue.");
  var text = "placeId\tname\tstartTimestampMs\tendTimestampMs\tlocationConfidence\tplaceConfidence\n";
  oTable.rows({filter: 'applied'}).every( function ( rowIdx, tableLoop, rowLoop ) {
    var data = this.data();
    text = text +
    // location cols
    data[5]["raw"] + "\t" + data[0]["raw"] +
    // datetime cols (timestamps)
    "\t" + data[1]["raw"] + "\t" + data[2]["raw"] +
    // confidence cols
    "\t" + data[3]["raw"] + "\t" + data[4]["raw"] + "\n";
  });
  var blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  saveAs(blob, PLAIN_OUTPUT_FILENAME);
  $("#downloadPlainButton").html("Locations downloaded to \"" + PLAIN_OUTPUT_FILENAME + "\"");
  $("#downloadPlainButton").prop("disabled",false);
}


$("#file").change(function(event) {
  if (oTable !== null) {
    oTable.clear();
  }
  $("#loadingMessage").html("Loading location data...");
  var files = event.target.files;
  // TODO(robon): Update loading message
  // requestAnimationFrame ensures status message is painted
	requestAnimationFrame(() => {
		for (var i = 0; i < files.length; i++) {
		  parseZipFile(files[i]);
		}
	});
  $("#loadingMessage").html("");
});

function parseHashFile(hashFile) {
  var fr = new FileReader();
  fr.onload = function(e) {
    var hashes = e.target.result.split("\n");
    for (var i = 0; i < hashes.length; i++) {
      intersectHashes[hashes[i]] = 1;
    }
    intersectHashFilename = hashFile.name;
    $("#intersectButton").prop("disabled", false);
    intersectHideDataMode = false;
    oTable.draw();
  }
  fr.readAsText(hashFile);
}

function intersectClear() {
    intersectHashFilename = "";
    intersectHashes = {};
    $("#intersectionMessage").html("");
    oTable.draw();
}
