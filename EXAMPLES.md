# Examples and Use Cases

## Example Use Cases

### 1. Team Avatars
Convert team member photos into emoji pixel art for fun Slack avatars or profile decorations.

**Settings:**
- Width: 15
- Height: 15
- Character Budget: 3000
- Tolerance: 20

### 2. Logo Recreation
Turn your company logo into emoji form for special announcements.

**Settings:**
- Width: 30
- Height: 20
- Character Budget: 8000
- Tolerance: 10

### 3. Memes and Reactions
Create custom emoji art reactions or memes to share in channels.

**Settings:**
- Width: 20
- Height: 20
- Character Budget: 5000
- Tolerance: 30

### 4. Event Banners
Design pixel art banners for team events, celebrations, or milestones.

**Settings:**
- Width: 40
- Height: 15
- Character Budget: 10000
- Tolerance: 25

## Sample Workflow

Here's a complete example workflow:

### Creating a Smiley Face

1. **Extract Emojis**
   - Go to `https://yourworkspace.slack.com/customize/emoji`
   - Click "Extract Emojis from Current Tab"
   - Wait for extraction to complete

2. **Find or Create Source Image**
   - Use a simple smiley face image
   - Recommended: 64x64 pixels or larger
   - High contrast works best

3. **Configure Settings**
   ```
   Width: 10
   Height: 10
   Character Budget: 2000
   Tolerance: 15
   ```

4. **Generate**
   - Click "Generate Pixel Art"
   - Preview the result
   - Adjust settings if needed

5. **Use in Slack**
   - Click "Copy to Clipboard"
   - Paste in any Slack message
   - Send!

## Expected Output Format

The output will be in Slack emoji format:
```
:yellow_circle::yellow_circle::yellow_circle::yellow_circle:
:yellow_circle::black_circle::yellow_circle::black_circle:
:yellow_circle::yellow_circle::yellow_circle::yellow_circle:
:yellow_circle::black_circle::black_circle::yellow_circle:
```

When pasted into Slack, this renders as emoji pixel art.

## Tips for Best Results

### Image Selection
- **Simple images** work better than complex photos
- **High contrast** images produce clearer results
- **Cartoons and icons** are ideal candidates
- **Logos** with solid colors convert well

### Dimension Guidelines
- **Small (10×10)**: Quick reactions, simple icons
- **Medium (20×20)**: Logos, faces, detailed icons
- **Large (30×30+)**: Banners, detailed scenes

### Character Budget Tips
- Slack has a ~40,000 character limit per message
- Each emoji is typically 8-15 characters (`:emoji_name:`)
- Budget calculator:
  - 10×10 grid ≈ 1,000-1,500 characters
  - 20×20 grid ≈ 4,000-6,000 characters
  - 30×30 grid ≈ 9,000-13,500 characters

### Tolerance Settings
- **Low (0-20)**: More variety, requires many unique emojis
- **Medium (20-50)**: Balanced, works for most workspaces
- **High (50-100)**: Allows repetition, works with fewer emojis

## Common Patterns

### Gradient Effect
For smooth gradients:
- Tolerance: 40-60
- Use workspace with many color variations
- Larger dimensions (25×25+)

### Pixel Art Style
For retro pixel art look:
- Tolerance: 10-20
- Smaller dimensions (10×15)
- High contrast source image

### Photo Realistic
For photo conversions:
- Tolerance: 30-50
- Medium-large dimensions (25×30)
- Workspace with diverse emoji colors
- Pre-process photo to increase contrast

## Troubleshooting Common Issues

### Output looks muddy or unclear
- **Solution**: Reduce dimensions, increase tolerance
- Try: 15×15 with tolerance 40

### Not enough unique emojis
- **Solution**: Increase tolerance or reduce dimensions
- Try: Tolerance 50+ or smaller grid

### Too many characters
- **Solution**: Reduce dimensions or set lower character budget
- Try: 15×15 with budget 3000

### Colors don't match well
- **Solution**: Your workspace needs more emoji variety
- Consider adding more custom emojis with different colors
- Use tolerance 60+ to allow reuse

## Advanced Techniques

### Multi-Part Images
For very large images:
1. Split into sections
2. Convert each section separately
3. Post as multiple messages
4. Thread them together

### Color Palette Optimization
Before converting:
1. Extract emojis and note dominant colors
2. Adjust source image to match available colors
3. This produces better color matching

### Pre-Processing
Use image editing software to:
- Increase contrast
- Reduce color count
- Apply posterize effect
- Adjust brightness/saturation

## Emoji Workspace Requirements

For best results, your Slack workspace should have:
- **Minimum**: 20-30 custom emojis with varied colors
- **Recommended**: 50+ custom emojis
- **Ideal**: 100+ custom emojis with full color spectrum

Default Slack emojis work but custom emojis typically provide better color variety.
