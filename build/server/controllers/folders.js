// Generated by CoffeeScript 1.10.0
var File, Folder, KB, MB, archiver, async, cozydb, findFolder, folderContentComparatorFactory, folderParent, getFolderPath, jade, log, moment, normalizePath, path, pathHelpers, resetTimeout, sharing, timeout, updateParents;

path = require('path');

jade = require('jade');

async = require('async');

archiver = require('archiver');

moment = require('moment');

log = require('printit')({
  prefix: 'folders'
});

sharing = require('../helpers/sharing');

pathHelpers = require('../helpers/path');

folderContentComparatorFactory = require('../helpers/file').folderContentComparatorFactory;

Folder = require('../models/folder');

File = require('../models/file');

cozydb = require('cozydb');

KB = 1024;

MB = KB * KB;

module.exports.fetch = function(req, res, next, id) {
  return Folder.request('all', {
    key: id
  }, function(err, folder) {
    if (err || !folder || folder.length === 0) {
      if (err == null) {
        err = new Error('File not found');
        err.status = 404;
        err.template = {
          name: '404',
          params: {
            localization: require('../lib/localization_manager'),
            isPublic: req.url.indexOf('public') !== -1
          }
        };
      }
      return next(err);
    } else {
      req.folder = folder[0];
      return next();
    }
  });
};

findFolder = function(id, callback) {
  return Folder.find(id, function(err, folder) {
    if (err || !folder) {
      return callback("Folder not found");
    } else {
      return callback(null, folder);
    }
  });
};

getFolderPath = function(id, cb) {
  if (id === 'root') {
    return cb(null, "");
  } else {
    return findFolder(id, function(err, folder) {
      if (err) {
        return cb(err);
      } else {
        return cb(null, folder.path + '/' + folder.name, folder);
      }
    });
  }
};

normalizePath = function(path) {
  if (path[0] !== '/') {
    path = "/" + path;
  }
  if (path === "/") {
    path = "";
  }
  return path;
};

folderParent = {};

timeout = null;

module.exports.create = function(req, res, next) {
  var folder;
  if (timeout != null) {
    clearTimeout(timeout);
  }
  folder = req.body;
  folder.path = normalizePath(folder.path);
  if ((!folder.name) || (folder.name === "")) {
    return next(new Error("Invalid arguments"));
  } else {
    return Folder.all(function(err, folders) {
      var available, createFolder, fullPath, now, parent, parents;
      available = pathHelpers.checkIfPathAvailable(folder, folders);
      if (!available) {
        return res.send({
          code: 'EEXISTS',
          error: true,
          msg: "This folder already exists"
        }, 400);
      } else {
        fullPath = folder.path;
        parents = folders.filter(function(tested) {
          return fullPath === tested.getFullPath();
        });
        now = moment().toISOString();
        createFolder = function() {
          folder.creationDate = now;
          folder.lastModification = now;
          return Folder.createNewFolder(folder, function(err, newFolder) {
            var who;
            resetTimeout();
            if (err) {
              return next(err);
            }
            who = req.guestEmail || 'owner';
            return sharing.notifyChanges(who, newFolder, function(err) {
              if (err) {
                console.log(err);
              }
              return res.send(newFolder, 200);
            });
          });
        };
        if (parents.length > 0) {
          parent = parents[0];
          folder.tags = parent.tags;
          parent.lastModification = now;
          folderParent[parent.name] = parent;
          return createFolder();
        } else {
          folder.tags = [];
          return createFolder();
        }
      }
    });
  }
};

resetTimeout = function() {
  if (timeout != null) {
    clearTimeout(timeout);
  }
  return timeout = setTimeout(updateParents, 60 * 1000);
};

updateParents = function() {
  var folder, name;
  for (name in folderParent) {
    folder = folderParent[name];
    folder.save(function(err) {
      if (err != null) {
        return log.error(err);
      }
    });
  }
  return folderParent = {};
};

module.exports.find = function(req, res, next) {
  return Folder.injectInheritedClearance([req.folder], function(err, folders) {
    return res.send(folders[0]);
  });
};

module.exports.tree = function(req, res, next) {
  var folderChild;
  folderChild = req.folder;
  return folderChild.getParents(function(err, folders) {
    if (err) {
      return next(err);
    } else {
      return res.send(folders, 200);
    }
  });
};

module.exports.list = function(req, res, next) {
  return Folder.allPath(function(err, paths) {
    if (err) {
      return next(err);
    } else {
      return res.send(paths);
    }
  });
};

module.exports.modify = function(req, res, next) {
  var body, folder, isPublic, newName, newPath, newRealPath, newTags, oldRealPath, previousName, previousPath, updateFoldersAndFiles, updateIfIsSubFolder, updateTheFolder;
  body = req.body;
  if (body.path != null) {
    body.path = normalizePath(body.path);
  }
  folder = req.folder;
  if ((req.body.name == null) && (req.body["public"] == null) && (req.body.tags == null) && (req.body.path == null)) {
    return res.send({
      error: true,
      msg: "Data required"
    }, 400);
  }
  previousName = folder.name;
  newName = body.name != null ? body.name : previousName;
  previousPath = folder.path;
  newPath = body.path != null ? body.path : previousPath;
  oldRealPath = previousPath + "/" + previousName;
  newRealPath = newPath + "/" + newName;
  newTags = req.body.tags || [];
  newTags = newTags.filter(function(tag) {
    return typeof tag === 'string';
  });
  isPublic = req.body["public"];
  updateIfIsSubFolder = function(file, cb) {
    var data, i, len, modifiedPath, oldTags, ref, tag, tags;
    if (((ref = file.path) != null ? ref.indexOf(oldRealPath) : void 0) === 0) {
      modifiedPath = file.path.replace(oldRealPath, newRealPath);
      oldTags = file.tags;
      tags = [].concat(oldTags);
      for (i = 0, len = newTags.length; i < len; i++) {
        tag = newTags[i];
        if (tags.indexOf(tag) === -1) {
          tags.push(tag);
        }
      }
      data = {
        path: modifiedPath,
        tags: tags
      };
      return file.updateAttributes(data, cb);
    } else {
      return cb(null);
    }
  };
  updateTheFolder = function() {
    var data;
    data = {
      name: newName,
      path: newPath,
      "public": isPublic,
      tags: newTags,
      lastModification: moment().toISOString()
    };
    if (req.body.clearance) {
      data.clearance = req.body.clearance;
    }
    return folder.updateParentModifDate(function(err) {
      if (err) {
        log.raw(err);
      }
      return folder.updateAttributes(data, function(err) {
        if (err) {
          return next(err);
        }
        return folder.updateParentModifDate(function(err) {
          if (err) {
            log.raw(err);
          }
          return folder.index(["name"], function(err) {
            if (err) {
              log.raw(err);
            }
            return res.send({
              success: 'File succesfuly modified'
            }, 200);
          });
        });
      });
    });
  };
  updateFoldersAndFiles = function(folders) {
    return async.each(folders, updateIfIsSubFolder, function(err) {
      if (err) {
        return next(err);
      } else {
        return File.all(function(err, files) {
          if (err) {
            return next(err);
          } else {
            return async.each(files, updateIfIsSubFolder, function(err) {
              if (err) {
                return next(err);
              } else {
                return updateTheFolder();
              }
            });
          }
        });
      }
    });
  };
  return Folder.byFullPath({
    key: newRealPath
  }, function(err, sameFolders) {
    if (err) {
      return next(err);
    }
    if (sameFolders.length > 0 && sameFolders[0].id !== req.body.id) {
      return res.send({
        error: true,
        msg: "The name already in use"
      }, 400);
    } else {
      return Folder.all(function(err, folders) {
        if (err) {
          return next(err);
        }
        return updateFoldersAndFiles(folders);
      });
    }
  });
};

module.exports.destroy = function(req, res, next) {
  var currentFolder, directory;
  currentFolder = req.folder;
  directory = currentFolder.path + "/" + currentFolder.name;
  return async.parallel([
    function(cb) {
      return Folder.all(cb);
    }, function(cb) {
      return File.all(cb);
    }
  ], function(err, elements) {
    var destroyElement, elementsToDelete, files, folders;
    if (err != null) {
      return next(err);
    }
    folders = elements[0], files = elements[1];
    elements = files.concat(folders);
    elementsToDelete = elements.filter(function(element) {
      var pathToTest;
      pathToTest = element.path + "/";
      return pathToTest.indexOf(directory + "/") === 0;
    });
    destroyElement = function(element, cb) {
      if (element.binary != null) {
        return element.destroyWithBinary(cb);
      } else {
        return element.destroy(cb);
      }
    };
    return async.each(elementsToDelete, destroyElement, function(err) {
      if (err != null) {
        return next(err);
      } else {
        return currentFolder.destroy(function(err) {
          if (err != null) {
            return next(err);
          } else {
            return currentFolder.updateParentModifDate(function(err) {
              if (err != null) {
                log.raw(err);
              }
              return res.send(204);
            });
          }
        });
      }
    });
  });
};

module.exports.findFiles = function(req, res, next) {
  return getFolderPath(req.body.id, function(err, key) {
    if (err) {
      return next(err);
    } else {
      return File.byFolder({
        key: key
      }, function(err, files) {
        if (err) {
          return next(err);
        } else {
          return res.send(files, 200);
        }
      });
    }
  });
};

module.exports.allFolders = function(req, res, next) {
  return Folder.all(function(err, folders) {
    if (err) {
      return next(err);
    } else {
      return res.send(folders);
    }
  });
};

module.exports.findContent = function(req, res, next) {
  var isPublic;
  isPublic = req.url.indexOf('/public/') !== -1;
  return getFolderPath(req.body.id, function(err, key, folder) {
    if (err != null) {
      return next(err);
    } else {
      return async.parallel([
        function(cb) {
          return Folder.byFolder({
            key: key
          }, function(err, folders) {
            if (isPublic) {
              return Folder.injectInheritedClearance(folders, cb);
            } else {
              return cb(null, folders);
            }
          });
        }, function(cb) {
          return File.byFolder({
            key: key
          }, function(err, files) {
            if (isPublic) {
              return File.injectInheritedClearance(files, cb);
            } else {
              return cb(null, files);
            }
          });
        }, function(cb) {
          var onResult;
          if (req.body.id === "root") {
            return cb(null, []);
          } else {
            if (isPublic) {
              onResult = function(parents, rule) {
                parents.pop();
                return cb(null, parents);
              };
              return sharing.limitedTree(folder, req, onResult);
            } else {
              return folder.getParents(cb);
            }
          }
        }
      ], function(err, results) {
        var comparator, content, files, folders, parents;
        if (err != null) {
          return next(err);
        } else {
          folders = results[0], files = results[1], parents = results[2];
          if (folders == null) {
            folders = [];
          }
          if (files == null) {
            files = [];
          }
          content = folders.concat(files);
          comparator = folderContentComparatorFactory('name', 'asc');
          content.sort(comparator);
          return res.send(200, {
            content: content,
            parents: parents
          });
        }
      });
    }
  });
};

module.exports.findFolders = function(req, res, next) {
  return getFolderPath(req.body.id, function(err, key) {
    if (err) {
      return next(err);
    } else {
      return Folder.byFolder({
        key: key
      }, function(err, files) {
        if (err) {
          return next(err);
        } else {
          return res.send(files, 200);
        }
      });
    }
  });
};

module.exports.search = function(req, res, next) {
  var parts, query, sendResults, tag;
  sendResults = function(err, files) {
    if (err) {
      return next(err);
    } else {
      return res.send(files);
    }
  };
  query = req.body.id;
  query = query.trim();
  if (query.indexOf('tag:') !== -1) {
    parts = query.split();
    parts = parts.filter(function(part) {
      return part.indexOf('tag:' !== -1);
    });
    tag = parts[0].split('tag:')[1];
    return Folder.request('byTag', {
      key: tag
    }, sendResults);
  } else {
    return Folder.search("*" + query + "*", sendResults);
  }
};

module.exports.searchContent = function(req, res, next) {
  var err, isPublic, key, parts, query, requests, tag;
  query = req.body.id;
  query = query.trim();
  isPublic = req.url.indexOf('/public/') === 0;
  key = req.query.key;
  if (isPublic && !(key != null ? key.length : void 0) > 0) {
    err = new Error('You cannot access public search result');
    err.status = 404;
    err.template = {
      name: '404',
      params: {
        localization: require('../lib/localization_manager'),
        isPublic: true
      }
    };
    return next(err);
  } else {
    if (query.indexOf('tag:') !== -1) {
      parts = query.split();
      parts = parts.filter(function(part) {
        return part.indexOf('tag:' !== -1);
      });
      tag = parts[0].split('tag:')[1];
      requests = [
        function(cb) {
          return Folder.request('byTag', {
            key: tag
          }, function(err, folders) {
            return Folder.injectInheritedClearance(folders, cb);
          });
        }, function(cb) {
          return File.request('byTag', {
            key: tag
          }, function(err, files) {
            return File.injectInheritedClearance(files, cb);
          });
        }
      ];
    } else {
      requests = [
        function(cb) {
          return Folder.search("*" + query + "*", cb);
        }, function(cb) {
          return File.search("*" + query + "*", cb);
        }
      ];
    }
    return async.parallel(requests, function(err, results) {
      var content, files, folders, isAuthorized, sendResults;
      if (err != null) {
        return next(err);
      } else {
        folders = results[0], files = results[1];
        content = folders.concat(files);
        sendResults = function(results) {
          return res.send(200, results);
        };
        if (key != null) {
          isAuthorized = function(element, callback) {
            return sharing.checkClearance(element, req, function(authorized) {
              return callback(authorized && element.clearance !== 'public');
            });
          };
          return async.filter(content, isAuthorized, function(results) {
            return sendResults(results);
          });
        } else {
          return sendResults(content);
        }
      }
    });
  }
};

module.exports.zip = function(req, res, next) {
  var addToArchive, archive, folder, key, makeZip, ref, ref1, selectedPaths, zipName;
  folder = req.folder;
  archive = archiver('zip');
  if (folder != null) {
    key = folder.path + "/" + folder.name;
    zipName = (ref = folder.name) != null ? ref.replace(/\W/g, '') : void 0;
  } else {
    key = "";
    zipName = 'cozy-files';
  }
  if (((ref1 = req.body) != null ? ref1.selectedPaths : void 0) != null) {
    selectedPaths = req.body.selectedPaths.split(';');
  } else {
    selectedPaths = [];
  }
  addToArchive = function(file, cb) {
    var laterStream, name;
    laterStream = file.getBinary("file", function(err) {
      if (err) {
        log.error("An error occured while adding a file to archive. File: " + file.name);
        log.raw(err);
        return cb();
      }
    });
    name = (file.path.replace(key, "")) + "/" + file.name;
    return laterStream.on('ready', function(stream) {
      archive.append(stream, {
        name: name
      });
      return cb();
    });
  };
  makeZip = function(zipName, files) {
    var disposition;
    archive.pipe(res);
    req.on('close', function() {
      return archive.abort();
    });
    disposition = "attachment; filename=\"" + zipName + ".zip\"";
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Type', 'application/zip');
    return async.eachSeries(files, addToArchive, function(err) {
      if (err) {
        return next(err);
      } else {
        return archive.finalize(function(err, bytes) {
          if (err) {
            return next(err);
          }
        });
      }
    });
  };
  return File.byFullPath({
    startkey: key + "/",
    endkey: key + "/\ufff0"
  }, function(err, files) {
    if (err) {
      return next(err);
    } else {
      files = files.filter(function(file) {
        var fileMatch, fullPath, subFolderMatch;
        fullPath = file.path + "/" + file.name;
        path = file.path + "/";
        fileMatch = selectedPaths.indexOf(fullPath) !== -1;
        subFolderMatch = selectedPaths.indexOf(path) !== -1;
        return selectedPaths.length === 0 || fileMatch || subFolderMatch;
      });
      return makeZip(zipName, files);
    }
  });
};

module.exports.changeNotificationsState = function(req, res, next) {
  var folder;
  folder = req.folder;
  return sharing.limitedTree(folder, req, function(path, rule) {
    var clearance, i, len, notif, r, results1;
    if (req.body.notificationsState == null) {
      return next(new Error('notifications must have a state'));
    } else {
      notif = req.body.notificationsState;
      notif = notif && notif !== 'false';
      clearance = path[0].clearance || [];
      results1 = [];
      for (i = 0, len = clearance.length; i < len; i++) {
        r = clearance[i];
        if (!(r.key === rule.key)) {
          continue;
        }
        rule.notifications = r.notifications = notif;
        results1.push(folder.updateAttributes({
          clearance: clearance
        }, function(err) {
          if (err != null) {
            return next(err);
          } else {
            return res.send(201);
          }
        }));
      }
      return results1;
    }
  });
};

module.exports.publicList = function(req, res, next) {
  var errortemplate, folder;
  folder = req.folder;
  if (~req.accepts(['html', 'json']).indexOf('html')) {
    errortemplate = function(err) {
      err = new Error('File not found');
      err.status = 404;
      err.template = {
        name: '404',
        params: {
          localization: require('../lib/localization_manager'),
          isPublic: req.url.indexOf('public') !== -1
        }
      };
      return next(err);
    };
    return sharing.limitedTree(folder, req, function(path, rule) {
      var authorized, key;
      authorized = path.length !== 0;
      if (!authorized) {
        return errortemplate();
      }
      key = folder.path + "/" + folder.name;
      return cozydb.api.getCozyLocale(function(err, lang) {
        var error, imports, publicKey;
        if (err) {
          return errortemplate(err);
        }
        publicKey = req.query.key || "";
        imports = "window.rootFolder = " + (JSON.stringify(folder)) + ";\nwindow.locale = \"" + lang + "\";\nwindow.tags = [];\nwindow.canUpload = " + (rule.perm === 'rw') + "\nwindow.publicNofications = " + (rule.notifications || false) + "\nwindow.publicKey = \"" + publicKey + "\"";
        try {
          return res.render('index', {
            imports: imports
          });
        } catch (error) {
          err = error;
          return errortemplate(err);
        }
      });
    });
  } else {
    return module.exports.find(req, res, next);
  }
};
