// PocketBase JavaScript Hooks
// Documentation: https://pocketbase.io/docs/js-overview/

// Example: Custom API endpoint
routerAdd("GET", "/api/hello", (c) => {
  return c.json(200, {
    "message": "Hello from PocketBase!",
    "timestamp": new Date().toISOString()
  })
})

// Example: Validate user registration (before creation)
onRecordCreateRequest((e) => {
  if (e.record.tableName() === "Users") {
    // Add custom validation logic here
    console.log("User created:", e.record.get("email"))
  }
  e.next()
}, "Users")

// Create workspace and workspace member when a new user is created
onRecordAfterCreateSuccess((e) => {
  const userId = e.record.id
  
  try {
    const workspacesCollection = $app.findCollectionByNameOrId("Workspaces")
    const workspaceMembersCollection = $app.findCollectionByNameOrId("WorkspaceMembers")
    
    const workspace = new Record(workspacesCollection)
    workspace.set("name", "New")
    $app.save(workspace)
    
    const workspaceMember = new Record(workspaceMembersCollection)
    workspaceMember.set("WorkspaceRef", workspace.id)
    workspaceMember.set("UserRef", userId)
    $app.save(workspaceMember)
  } catch (error) {
    console.error("Error creating workspace for user:", userId, error)
  }
}, "Users")