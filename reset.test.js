const fs = require('node:fs');
const path = require('node:path');

// Mock fs
jest.mock('node:fs');

describe('reset.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the require cache so we can re-run the script
    delete require.cache[require.resolve('./reset.js')];
  });

  it('removes expected files and restores Parturition.md', () => {
    // Mock existence of files
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['memory-123.json', 'not-memory.txt']);
    fs.unlinkSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    // Run the script
    require('./reset.js');

    // Verify removals
    // Soul.md, Identity.md, user.md, memory.md
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('Soul.md'));
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('Identity.md'));
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('user.md'));
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('memory.md'));

    // Verify JSON memory removal
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('memory-123.json'));
    expect(fs.unlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('not-memory.txt'));

    // Verify restoration
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('Parturition.md'),
      expect.stringContaining('# Parturition Bootstrap'),
    );
  });

  it('handles non-existent directories gracefully', () => {
    fs.existsSync.mockReturnValue(false);
    require('./reset.js');
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});
