# Installing from GitHub (Without npm)

## ✅ Yes, You Can Install Directly from GitHub!

You don't need to publish to npm. Workers can install directly from your GitHub repository.

---

## 🚀 Installation Methods

### Method 1: Install from GitHub (Recommended)

In your worker project's `package.json`:

```json
{
  "dependencies": {
    "meteor-job-collection": "github:strigo/meteor-job-collection#v2.0.0"
  }
}
```

Then install:
```bash
npm install
```

### Method 2: Install with npm Command

```bash
npm install github:strigo/meteor-job-collection
```

### Method 3: Install Specific Branch/Tag

```bash
# Install from main branch
npm install github:strigo/meteor-job-collection

# Install from specific tag
npm install github:strigo/meteor-job-collection#v2.0.0

# Install from specific commit
npm install github:strigo/meteor-job-collection#abc1234
```

---

## 📝 Example Worker Setup

### Your Worker Project

```bash
mkdir email-worker
cd email-worker
npm init -y
```

**package.json:**
```json
{
  "name": "email-worker",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "meteor-job-collection": "github:strigo/meteor-job-collection#v2.0.0",
    "ddp": "^0.12.1",
    "ddp-login": "^1.1.1"
  }
}
```

**worker.js:**
```javascript
import DDP from 'ddp';
import DDPLogin from 'ddp-login';
import { Job } from 'meteor-job-collection';  // ✅ Works from GitHub!

const ddp = new DDP({
  host: 'localhost',
  port: 3000,
  use_ejson: true
});

Job.setDDP(ddp);

ddp.connect(async (err) => {
  if (err) throw err;
  
  console.log('Connected to Meteor');
  
  await DDPLogin(ddp, {
    env: 'METEOR_TOKEN',
    method: 'token'
  });
  
  console.log('Authenticated');
  
  const workers = Job.processJobs(
    'myQueue',
    'sendEmail',
    { concurrency: 10 },
    async (job, callback) => {
      console.log('Processing job:', job.data);
      await sendEmail(job.data);
      await job.done();
      callback();
    }
  );
  
  console.log('Worker started');
});
```

**Run:**
```bash
npm install
node worker.js
```

---

## ✅ Why This Works

### The `dist/` Folder is Committed

Your package includes the compiled JavaScript in the `dist/` folder in git, so:

1. ✅ User installs from GitHub
2. ✅ npm downloads the repo (including `dist/`)
3. ✅ Package.json points to `dist/index.js`
4. ✅ Everything works!

No npm publish needed!

---

## 🔧 Important: Keep dist/ in Git

Make sure `dist/` is committed to git:

```bash
# Add dist folder to git
git add dist/

# Commit
git commit -m "Add compiled dist/ for GitHub installs"

# Push
git push origin main

# Tag for versions
git tag v2.0.0
git push origin v2.0.0
```

---

## 📦 Comparison

| Method | Command | Use Case |
|--------|---------|----------|
| **GitHub** | `npm install github:strigo/meteor-job-collection` | ✅ Quick, no npm account needed |
| **npm** | `npm install @strigo/meteor-job-collection` | Better for production, versioning |
| **Meteor** | `meteor add strigops:job-collection` | Meteor apps only |

---

## 💡 Recommendations

### For Development/Testing
```json
// package.json in worker
{
  "dependencies": {
    "meteor-job-collection": "github:strigo/meteor-job-collection#main"
  }
}
```

### For Production
```json
// Use tagged versions
{
  "dependencies": {
    "meteor-job-collection": "github:strigo/meteor-job-collection#v2.0.0"
  }
}
```

### For Public Distribution
Publish to npm:
```bash
npm publish --access public
```

Then users can use semver:
```json
{
  "dependencies": {
    "@strigo/meteor-job-collection": "^2.0.0"
  }
}
```

---

## 🎯 Best Practice

**For Your Own Workers:**
- ✅ GitHub install is perfect!
- ✅ No npm publish needed
- ✅ Version with git tags

**If Sharing Publicly:**
- ✅ Publish to npm for better discoverability
- ✅ Semantic versioning
- ✅ npm security scanning

---

## 🔄 Updating Your Workers

When you make changes:

```bash
# In meteor-job-collection repo
npm run build
git add dist/
git commit -m "Update to v2.0.1"
git tag v2.0.1
git push origin main --tags

# In worker repo
npm update meteor-job-collection
# Or
npm install github:strigo/meteor-job-collection#v2.0.1
```

---

## ✅ Summary

**YES!** You can absolutely use GitHub directly without npm:

```bash
# In your worker project
npm install github:strigo/meteor-job-collection#v2.0.0
```

Just make sure `dist/` is committed to your GitHub repo (which it will be once you push).

**No npm publish required for private/internal workers!** 🎉

