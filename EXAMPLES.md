# Examples and Use Cases

## Example Use Cases

### 1. Team Avatars
Convert team member photos into emoji pixel art for fun Slack avatars or profile decorations.

**Settings:**
- Width: 15
- Height: 15
- Character Budget: 3000
- Tolerance: 20
- Dithering: Enabled
- Dithering Strength: 85
- Prefer Solid Emojis: 60
- Raster Quality: 4

### 2. Logo Recreation
Turn your company logo into emoji form for special announcements.

**Settings:**
- Width: 30
- Height: 20
- Character Budget: 8000
- Tolerance: 10
- Dithering: Disabled (logos have solid colors)
- Prefer Solid Emojis: 70
- Raster Quality: 3

### 3. Memes and Reactions
Create custom emoji art reactions or memes to share in channels.

**Settings:**
- Width: 20
- Height: 20
- Character Budget: 5000
- Tolerance: 30
- Dithering: Enabled
- Dithering Strength: 75
- Prefer Solid Emojis: 50
- Raster Quality: 3

### 4. Event Banners
Design pixel art banners for team events, celebrations, or milestones.

**Settings:**
- Width: 40
- Height: 15
- Character Budget: 10000
- Tolerance: 25
- Dithering: Enabled
- Dithering Strength: 80
- Prefer Solid Emojis: 55
- Raster Quality: 3

## Sample Workflow

Here's a complete example workflow:

### Creating a Smiley Face

1. **Extract Emojis**
   - Go to `https://yourworkspace.slack.com/customize/emoji`
   - Click "Extract Emojis"
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
   Dithering: Disabled (for simple shapes)
   Prefer Solid Emojis: 65
   Raster Quality: 3
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

### Dithering Settings
- **Enabled with high strength (80-100)**: Best for photos with gradients and subtle color variations
- **Enabled with medium strength (60-80)**: Good balance for most images
- **Enabled with low strength (30-60)**: Subtle smoothing for semi-detailed images
- **Disabled**: Best for logos, pixel art, or images with solid color blocks

### Prefer Solid Emojis (Texture Penalty)
- **Low (0-30)**: Allows all emoji types including detailed/outlined ones
- **Medium (30-60)**: Balanced selection, default for most use cases
- **High (60-80)**: Strongly prefers solid color emojis for photo-like results
- **Very High (80-100)**: Maximum preference for solid emojis, may limit variety

### Raster Quality
- **Low (1-2)**: Fastest processing, good for simple images
- **Medium (3)**: Default setting, good balance of speed and quality
- **High (4-5)**: Better color matching for complex images, slightly slower

## Common Patterns

### Gradient Effect
For smooth gradients:
- Tolerance: 40-60
- Dithering: Enabled
- Dithering Strength: 85-95
- Prefer Solid Emojis: 50-60
- Use workspace with many color variations
- Larger dimensions (25×25+)

### Pixel Art Style
For retro pixel art look:
- Tolerance: 10-20
- Dithering: Disabled
- Prefer Solid Emojis: 70-80
- Smaller dimensions (10×15)
- High contrast source image

### Photo Realistic
For photo conversions:
- Tolerance: 30-50
- Dithering: Enabled
- Dithering Strength: 80-90
- Prefer Solid Emojis: 65-75
- Raster Quality: 4-5
- Medium-large dimensions (25×30)
- Workspace with diverse emoji colors
- Pre-process photo to increase contrast

## Troubleshooting Common Issues

### Output looks muddy or unclear
- **Solution**: Reduce dimensions, increase tolerance, or adjust dithering
- Try: 15×15 with tolerance 40 and dithering disabled
- Or: Enable "Prefer Solid Emojis" at 70+

### Output has too much pattern/texture
- **Solution**: Increase "Prefer Solid Emojis" setting
- Try: Prefer Solid Emojis at 70-80
- This penalizes busy or outlined emojis

### Not enough unique emojis
- **Solution**: Increase tolerance or reduce dimensions
- Try: Tolerance 50+ or smaller grid

### Too many characters
- **Solution**: Reduce dimensions or set lower character budget
- Try: 15×15 with budget 3000

### Colors don't match well
- **Solution**: Your workspace needs more emoji variety or adjust raster quality
- Consider adding more custom emojis with different colors
- Use tolerance 60+ to allow reuse
- Try increasing Raster Quality to 4-5 for better color sampling

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
- For photos: Consider pre-dithering for specific effects

### Optimizing for Your Workspace
1. Extract your workspace emojis and review the Visual preview
2. Note which colors are well-represented and which are missing
3. Adjust source image colors to match available emoji colors
4. Adjust "Prefer Solid Emojis" based on emoji types in your workspace
5. Use higher Raster Quality (4-5) if you have many similar colors

## Emoji Workspace Requirements

For best results, your Slack workspace should have:
- **Minimum**: 20-30 custom emojis with varied colors
- **Recommended**: 50+ custom emojis
- **Ideal**: 100+ custom emojis with full color spectrum

Default Slack emojis work but custom emojis typically provide better color variety.
