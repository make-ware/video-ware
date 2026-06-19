// PocketBase JavaScript Hooks
// Documentation: https://pocketbase.io/docs/js-overview/

// Example: Custom API endpoint
routerAdd('GET', '/api/hello', (c) => {
  return c.json(200, {
    message: 'Hello from PocketBase!',
    timestamp: new Date().toISOString(),
  });
});

// Example: Validate user registration (before creation)
onRecordCreateRequest((e) => {
  if (e.record.tableName() === 'Users') {
    // Add custom validation logic here
    console.log('User created:', e.record.get('email'));
  }
  e.next();
}, 'Users');
