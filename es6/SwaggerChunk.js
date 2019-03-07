const program = require('commander')
const fs = require('fs-extra')
const path = require('path')
require('colors')
const resolveRefs = require('json-refs').resolveRefs
const YAML = require('js-yaml')
const logErrorExit = require('../logErrorExit')

export default class SwaggerChunk {

  /**
   * @param program
   * {
   *  input: string,
   *  appendVersion:   ? bool defaults to false
   * }
   */
  constructor (program = {}) {
    if (!program.input) {
      logErrorExit('No input provided')
    } else {
      if (!fs.existsSync(program.input)) {
        logErrorExit('File does not exist. (' + program.input + ')')
      }
    }
    this.mainJSON = ''
    this.appendVersion = (program.exclude_version !== true)
    this.input = program.input
    this.hostReplacement = program.host_replacement || false
    this.cleanLeaf = program.clean_leaf || false
    this.validateOff = program.validate_off || false
    this.destination = program.destination || false
    this.indentation = program.indentation || 4
  }

  readJsonFile (file) {
    try {
      return JSON.parse(fs.readFileSync(file))
    } catch (err) {
      return null
    }
  }

  packageJson () {
    return this.readJsonFile('./package.json')
  }
  parseMainLoaderOptions () {
    return {
      loaderOptions: {
        processContent: (res, callback) => {
          try {
            callback(null, YAML.safeLoad(res.text))
          } catch (e) {
            logErrorExit({
              msg: 'Error parsing yml',
              e: e
            })
          }
        }
      }
    }
  }
  parseMainRoot () {
    return YAML.safeLoad(fs.readFileSync(this.input).toString())
  }
  parseMain () {
    return new Promise((resolve) => {
      const root = this.parseMainRoot()
      const pwd = process.cwd()
      process.chdir(path.dirname(this.input))
      resolveRefs(root, this.parseMainLoaderOptions()).then((results) => {
        this.mainJSON = this.swaggerChunkConversions(results.resolved)
        this.validate()
          .then(() => {
            process.chdir(pwd)
            return resolve(this.mainJSON)
          })
          .catch((e) => {
            logErrorExit({
              msg: 'Error parsing output',
              e: e
            })
          })
      }).catch((e) => {
        logErrorExit({
          msg: 'Error resolving',
          e: e
        })
      })
    })
  }

  validate () {
    return new Promise((resolve, reject) => {
      if (!this.validateOff) {
        var SwaggerParser = require('swagger-parser')
        SwaggerParser.validate(this.cloneObject(this.mainJSON), {}, (e) => {
          if (e) {
            return reject(e.message)
          }
          return resolve()
        })
      } else {
        return resolve()
      }
    })
  }

  cloneObject (src) {
    return JSON.parse(JSON.stringify(src))
  }

  swaggerChunkConversions (swaggerDocument) {
    if (this.hostReplacement) {
      swaggerDocument.host = this.hostReplacement
    }
    if (this.cleanLeaf) {
      swaggerDocument = this.cleanLeafs(swaggerDocument)
    }
    return swaggerDocument
  }

  lastChar (string) {
    return string[string.length - 1]
  }

  removeLastChar (str) {
    return str.slice(0, -1)
  }

  cleanLeafs (swaggerDocument) {
    for (let key in swaggerDocument) {
      if (typeof swaggerDocument[key] === 'object') {
        swaggerDocument[key] = this.cleanLeafs(swaggerDocument[key])
      } else {
        if (this.lastChar(swaggerDocument[key]) === ',') {
          swaggerDocument[key] = this.removeLastChar(swaggerDocument[key])
        }
      }
    }
    return swaggerDocument
  }

  getVersion () {
    let swagVersion = ''
    if (!this.appendVersion) {
      return swagVersion
    }
    let parsedResltObj = this.mainJSON
    if (parsedResltObj.info.version) {
      swagVersion = parsedResltObj.info.version
    } else if (!program.Version) {
      const packageJson = (this.packageJson())
      if (packageJson.version) {
        swagVersion = packageJson.version
      } else {
        // try and get the version from the yml file
        return logErrorExit('No version provided and no version in the package.json')
      }
    }
    return '_' + swagVersion
  }

  getFileName (name, ext) {
    return name + this.getVersion() + '.' + ext
  }

  writeFile (dir, name, ext, contents) {
    try {
      fs.ensureDirSync(dir)
      return fs.writeFileSync(path.join(dir, this.getFileName(name, ext)), contents)
    } catch (e) {
      logErrorExit({
        msg: 'Error writing file',
        e: e
      })
    }
  }

  toJsonFile (dir, name, ext) {
    this.destination = dir || false
    ext = ext || 'json'
    return new Promise((resolve, reject) => {
      this.toJSON().then((json) => {
        if (!this.destination) {
          console.log(JSON.stringify(this.mainJSON, null, 4))
          return resolve()
        }
        this.writeFile(dir, name, ext, JSON.stringify(json, null, this.indentation))
        resolve('File written to: ' + path.join(dir, this.getFileName(name, ext)))
      }).catch(reject)
    })
  }

  toJSON () {
    return new Promise((resolve, reject) => {
      this.parseMain().then((json) => {
        return resolve(json)
      }).catch(reject)
    })
  }

  toYamlFile (dir, name, ext) {
    ext = ext || 'yaml'
    this.destination = dir || false
    return new Promise((resolve, reject) => {
      this.toYAML().then((yml) => {
        if (!this.destination) {
          console.log(yml)
          return resolve()
        }
        this.writeFile(dir, name, ext, yml)
        resolve('File written to: ' + path.join(dir, this.getFileName(name, ext)))
      }).catch(reject)
    })
  }

  toYAML () {
    return new Promise((resolve, reject) => {
      this.parseMain().then((json) => {
        return resolve(
          YAML.safeDump(
            json,
            this.indentation
          )
        )
      }).catch(reject)
    })
  }
}
