resource "aws_s3_bucket" "assets" {
  bucket = "rollcage-demo-assets"
  acl    = "public-read"
}

resource "aws_ebs_volume" "scratch" {
  availability_zone = "us-east-1a"
  size              = 20
  encrypted         = false
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = "rollcage-demo-deploy"
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }]
  })
}
