# Environment Setup for Migration

## Prerequisites

### System Requirements

1. **Operating System**
   - Linux, macOS, or Windows with WSL2
   - Minimum 8GB RAM recommended
   - 10GB free disk space

2. **Node.js**
   - Version: 22.x or higher (Meteor 3.x requirement)
   - Install via nvm for version management:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 22
   nvm use 22
   ```

3. **MongoDB**
   - Version: 7.0.16 or higher
   - Local or remote instance for testing
   ```bash
   # Using Docker for local MongoDB
   docker run -d -p 27017:27017 --name mongo7 mongo:7.0.16
   ```

## Meteor Installation

### Install Meteor 3.2+

```bash
# Remove old Meteor installation if exists
rm -rf ~/.meteor

# Install Meteor 3.2+
npx meteor@3.2

# Verify installation
meteor --version
# Should output: Meteor 3.2.x
```

### Create Test Application

```bash
# Create a new Meteor 3.x app for testing
meteor create test-job-collection-app --release 3.2
cd test-job-collection-app

# Remove default packages we don't need
meteor remove autopublish insecure

# Add necessary packages for testing
meteor add accounts-password
meteor add check
```

## Development Tools

### Required Tools

1. **Code Conversion Tools**
   ```bash
   # Install decaffeinate for CoffeeScript conversion
   npm install -g decaffeinate
   
   # Install prettier for code formatting
   npm install -g prettier
   
   # Install ESLint for code quality
   npm install -g eslint
   ```

2. **Testing Tools**
   ```bash
   # Install testing dependencies
   npm install --save-dev mocha chai sinon
   npm install --save-dev @types/meteor
   ```

3. **Development Dependencies**
   ```bash
   # In the package directory
   cd /path/to/meteor-job-collection
   
   # Initialize npm if not already done
   npm init -y
   
   # Install development dependencies
   npm install --save-dev \
     @babel/core \
     @babel/preset-env \
     @babel/plugin-transform-runtime \
     eslint \
     eslint-config-meteor \
     prettier
   ```

## Project Structure Setup

### 1. Clone and Prepare Repository

```bash
# Clone your forked repository
git clone https://github.com/yourusername/meteor-job-collection.git
cd meteor-job-collection

# Create migration branch
git checkout -b meteor-3-migration

# Create new directory structure
mkdir -p lib/
mkdir -p lib/client
mkdir -p lib/server
mkdir -p lib/common
```

### 2. Setup Configuration Files

#### .eslintrc.json
```json
{
  "extends": ["eslint:recommended"],
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "env": {
    "es6": true,
    "node": true,
    "meteor": true,
    "browser": true
  },
  "globals": {
    "Assets": "readonly",
    "Package": "readonly",
    "Npm": "readonly",
    "Mongo": "readonly",
    "Meteor": "readonly",
    "DDP": "readonly",
    "Accounts": "readonly",
    "Match": "readonly",
    "check": "readonly",
    "Job": "readonly",
    "JobCollection": "readonly"
  },
  "rules": {
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": "warn",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

#### .prettierrc
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

#### .gitignore additions
```bash
# Add to existing .gitignore
node_modules/
npm-debug.log*
.npm/
.meteor/local
.meteor/meteorite
*.log
.DS_Store
.idea/
.vscode/
*.swp
*.swo
```

## Conversion Environment

### Setup Conversion Scripts

Create `scripts/convert.sh`:

```bash
#!/bin/bash

# CoffeeScript to JavaScript conversion script

echo "Starting CoffeeScript to JavaScript conversion..."

# Convert main package files
decaffeinate src/shared.coffee --use-cs2 --loose --keep-commonjs
decaffeinate src/server.coffee --use-cs2 --loose --keep-commonjs
decaffeinate src/client.coffee --use-cs2 --loose --keep-commonjs

# Convert job class
decaffeinate job/src/job_class.coffee --use-cs2 --loose --keep-commonjs

# Convert tests
decaffeinate test/job_collection_tests.coffee --use-cs2 --loose --keep-commonjs

# Move converted files to lib directory
mv src/shared.js lib/common/shared.js
mv src/server.js lib/server/server.js
mv src/client.js lib/client/client.js
mv job/src/job_class.js lib/common/job_class.js
mv test/job_collection_tests.js test/job_collection_tests.js

echo "Conversion complete! Check lib/ directory for converted files."
```

Make it executable:
```bash
chmod +x scripts/convert.sh
```

### Setup Testing Environment

Create `test-app/package.json`:

```json
{
  "name": "job-collection-test-app",
  "private": true,
  "scripts": {
    "start": "meteor run",
    "test": "meteor test --driver-package meteortesting:mocha",
    "test-app": "TEST_WATCH=1 meteor test --full-app --driver-package meteortesting:mocha"
  },
  "dependencies": {
    "@babel/runtime": "^7.23.0",
    "meteor-node-stubs": "^1.2.0"
  },
  "devDependencies": {
    "chai": "^4.3.0"
  }
}
```

## MongoDB Setup for Development

### Local MongoDB Configuration

1. **Create MongoDB Data Directory**
   ```bash
   mkdir -p ~/mongodb-data/meteor-job-collection
   ```

2. **Start MongoDB with Replica Set** (required for change streams)
   ```bash
   mongod --replSet rs0 --dbpath ~/mongodb-data/meteor-job-collection
   
   # In another terminal, initialize replica set
   mongosh --eval "rs.initiate()"
   ```

3. **MongoDB Connection String**
   ```bash
   # For local development
   export MONGO_URL="mongodb://localhost:27017/meteor-job-collection"
   
   # For Meteor app
   meteor --settings settings.json
   ```

## IDE Configuration

### Visual Studio Code

Recommended extensions:
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "streetsidesoftware.code-spell-checker",
    "mongodb.mongodb-vscode"
  ]
}
```

Settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.autoFixOnSave": true,
  "files.exclude": {
    "**/.git": true,
    "**/.meteor/local": true,
    "**/node_modules": true
  }
}
```

## Verification Checklist

- [ ] Node.js 22+ installed
- [ ] Meteor 3.2+ installed
- [ ] MongoDB 7.0+ running
- [ ] Development tools installed (decaffeinate, prettier, eslint)
- [ ] Test Meteor app created
- [ ] Repository cloned and migration branch created
- [ ] Configuration files in place
- [ ] Conversion scripts ready
- [ ] IDE properly configured

## Troubleshooting

### Common Issues

1. **Meteor Installation Fails**
   ```bash
   # Clear npm cache
   npm cache clean --force
   
   # Try alternative installation
   curl https://install.meteor.com/ | sh
   ```

2. **MongoDB Connection Issues**
   ```bash
   # Check MongoDB is running
   ps aux | grep mongod
   
   # Check connection
   mongosh --eval "db.version()"
   ```

3. **Node Version Conflicts**
   ```bash
   # Use nvm to switch versions
   nvm use 22
   
   # Set default
   nvm alias default 22
   ```

## Next Steps

Once the environment is set up:
1. Run the conversion script to transform CoffeeScript files
2. Begin manual cleanup and modernization
3. Start implementing async/await patterns
4. Test incrementally with the test app

## Resources

- [Meteor 3.x Installation Guide](https://docs.meteor.com/install.html)
- [MongoDB Installation](https://docs.mongodb.com/manual/installation/)
- [Node.js via NVM](https://github.com/nvm-sh/nvm)
- [Decaffeinate Documentation](https://github.com/decaffeinate/decaffeinate)
